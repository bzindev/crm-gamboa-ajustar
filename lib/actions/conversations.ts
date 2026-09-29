"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/create";
import { updateConversationStatusSchema } from "@/lib/validation/conversations";
import { z } from "zod";
import { colorForTag } from "@/lib/crm/temperature";

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export type ConversationActionState = { error?: string } | null;

export async function updateConversationStatus(
  _prevState: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = updateConversationStatusSchema.safeParse({
    conversationId: formData.get("conversationId"),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("conversations")
    .select("status")
    .eq("id", parsed.data.conversationId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  const { error } = await supabase
    .from("conversations")
    .update({ status: parsed.data.status })
    .eq("id", parsed.data.conversationId)
    .eq("org_id", membership.orgId);

  if (error) {
    console.error("[conversations] updateConversationStatus falhou:", error.code, error.message);
    return { error: "Não foi possível atualizar o status." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "conversation.status_changed",
    resourceType: "conversations",
    resourceId: parsed.data.conversationId,
    before: { status: current?.status ?? null },
    after: { status: parsed.data.status },
  });

  if (current && parsed.data.status === "resolved" && current.status !== "resolved") {
    await queueCsatSurvey(supabase, parsed.data.conversationId);
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return null;
}

/**
 * Deixa a pesquisa "pendente" — quem envia é o worker (lib/whatsapp/
 * csat-worker.ts), que tem o token do canal. A criação é uma função no
 * banco (migration 0028): ela tira org/contato/vendedor da própria conversa
 * e confere se está resolvida e com a pesquisa ligada — membro não grava
 * direto em csat_surveys (nota é do cliente, não do vendedor).
 */
async function queueCsatSurvey(supabase: Awaited<ReturnType<typeof createClient>>, conversationId: string) {
  const { error } = await supabase.rpc("fn_queue_csat_survey", { p_conversation_id: conversationId });
  if (error) console.error("[conversations] fn_queue_csat_survey falhou:", error.code, error.message);
}

export async function claimConversation(
  _prevState: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const conversationId = formData.get("conversationId");
  if (typeof conversationId !== "string" || !conversationId) {
    return { error: "Conversa inválida." };
  }

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("assigned_to")
    .eq("id", conversationId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!conversation) {
    return { error: "Conversa não encontrada." };
  }

  // Vendedor comum só assume o que está livre; gestor/admin pode tomar de
  // volta uma conversa já atribuída (ex.: colega saiu, precisa realocar).
  const isManagerOrAbove = membership.role !== "agent";
  if (conversation.assigned_to && conversation.assigned_to !== membership.userId && !isManagerOrAbove) {
    return { error: "Essa conversa já está com outro vendedor." };
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("conversations")
    .update({ assigned_to: membership.userId, last_read_at: nowIso, assigned_at: nowIso })
    .eq("id", conversationId);

  if (error) {
    console.error("[conversations] claimConversation falhou:", error.code, error.message);
    return { error: "Não foi possível assumir a conversa." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "conversation.claimed",
    resourceType: "conversations",
    resourceId: conversationId,
    before: { assigned_to: conversation.assigned_to },
    after: { assigned_to: membership.userId },
  });

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${conversationId}`);
  return null;
}

/**
 * Repassar deliberadamente pra um colega específico — diferente de
 * "assumir" (que só pega algo livre ou, sendo gestor, toma de volta).
 * Vendedor comum só repassa a PRÓPRIA conversa; gestor/admin repassa
 * qualquer uma, mesma régua de quem pode tomar de volta via
 * claimConversation.
 */
export async function transferConversation(
  _prevState: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const conversationId = formData.get("conversationId");
  const targetUserId = formData.get("targetUserId");
  if (typeof conversationId !== "string" || !conversationId) {
    return { error: "Conversa inválida." };
  }
  if (typeof targetUserId !== "string" || !targetUserId) {
    return { error: "Escolha quem vai receber a conversa." };
  }

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("assigned_to, contacts(name, phone_e164)")
    .eq("id", conversationId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!conversation) {
    return { error: "Conversa não encontrada." };
  }

  const isManagerOrAbove = membership.role !== "agent";
  if (conversation.assigned_to !== membership.userId && !isManagerOrAbove) {
    return { error: "Só quem está atendendo pode repassar essa conversa." };
  }

  if (targetUserId === conversation.assigned_to) {
    return { error: "Essa conversa já é dessa pessoa." };
  }

  // Nunca confia só no <select> do cliente — confirma que o alvo é membro
  // aceito desta mesma organização antes de gravar.
  const { data: targetMember } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", membership.orgId)
    .eq("user_id", targetUserId)
    .not("accepted_at", "is", null)
    .maybeSingle();
  if (!targetMember) {
    return { error: "Esse usuário não faz parte da organização." };
  }

  const previousOwner = conversation.assigned_to;
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("conversations")
    .update({ assigned_to: targetUserId, assigned_at: nowIso })
    .eq("id", conversationId)
    .eq("org_id", membership.orgId);

  if (error) {
    console.error("[conversations] transferConversation falhou:", error.code, error.message);
    return { error: "Não foi possível transferir a conversa." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "conversation.transferred",
    resourceType: "conversations",
    resourceId: conversationId,
    before: { assigned_to: previousOwner },
    after: { assigned_to: targetUserId },
  });

  const contact = one(conversation.contacts);
  const contactLabel = contact?.name ?? contact?.phone_e164 ?? undefined;

  await createNotification(supabase, {
    orgId: membership.orgId,
    userId: targetUserId,
    type: "lead.assigned",
    title: "Lead atribuído a você",
    body: contactLabel,
    link: `/inbox/${conversationId}`,
  });

  // Só avisa quem perdeu se não foi ela mesma que decidiu repassar (gestor
  // tomando de um vendedor pra dar a outro, por exemplo) — quem repassa por
  // conta própria já sabe que abriu mão.
  if (previousOwner && previousOwner !== membership.userId) {
    await createNotification(supabase, {
      orgId: membership.orgId,
      userId: previousOwner,
      type: "conversation.transferred_away",
      title: "Conversa transferida",
      body: contactLabel,
      link: `/inbox/${conversationId}`,
    });
  }

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${conversationId}`);
  return null;
}

/**
 * Chamado ao abrir (ou voltar o foco para) uma conversa — base do contador
 * de não lidas no título da aba. Só grava quando quem chama é o próprio
 * responsável: um gestor abrindo a conversa de outro vendedor pra
 * acompanhar (ver 2486ef6) não pode "zerar" a notificação de quem ainda não
 * respondeu de fato.
 */
export async function markConversationRead(conversationId: string): Promise<void> {
  const membership = await getActiveOrgMembership();
  if (!membership) return;

  const supabase = await createClient();
  await supabase
    .from("conversations")
    .update({ last_read_at: new Date().toISOString() })
    .eq("id", conversationId)
    .eq("org_id", membership.orgId)
    .eq("assigned_to", membership.userId);
}

// ---------------------------------------------------------------------------
// Temperatura e etiquetas da conversa. Qualquer membro da organização pode
// marcar — é organização do trabalho, não muda quem atende.
// ---------------------------------------------------------------------------

export type LabelActionResult = { error?: string };

async function conversationInOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  orgId: string,
) {
  const { data } = await supabase
    .from("conversations")
    .select("id, temperature")
    .eq("id", conversationId)
    .eq("org_id", orgId)
    .maybeSingle();
  return data;
}

const temperatureInput = z.object({
  conversationId: z.string().uuid(),
  temperature: z.enum(["hot", "warm", "cold"]).nullable(),
});

export async function setConversationTemperature(
  input: z.input<typeof temperatureInput>,
): Promise<LabelActionResult> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }
  const parsed = temperatureInput.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const supabase = await createClient();
  const current = await conversationInOrg(supabase, parsed.data.conversationId, membership.orgId);
  if (!current) return { error: "Conversa não encontrada." };

  const { error } = await supabase
    .from("conversations")
    .update({ temperature: parsed.data.temperature })
    .eq("id", parsed.data.conversationId)
    .eq("org_id", membership.orgId);
  if (error) {
    console.error("[conversations] setConversationTemperature falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "conversation.temperature_changed",
    resourceType: "conversations",
    resourceId: parsed.data.conversationId,
    before: { temperature: current.temperature },
    after: { temperature: parsed.data.temperature },
  });

  revalidatePath("/inbox", "layout");
  return {};
}

const tagsInput = z.object({
  conversationId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()).max(30),
});

/** Substitui o conjunto de etiquetas da conversa pelo que veio (lista pequena — não compensa diff fino). */
export async function setConversationTags(input: z.input<typeof tagsInput>): Promise<LabelActionResult> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }
  const parsed = tagsInput.safeParse(input);
  if (!parsed.success) return { error: "Dados inválidos." };

  const supabase = await createClient();
  if (!(await conversationInOrg(supabase, parsed.data.conversationId, membership.orgId))) {
    return { error: "Conversa não encontrada." };
  }

  // Só etiqueta desta organização — nunca confia na lista que veio do cliente.
  const wanted = [...new Set(parsed.data.tagIds)];
  const { data: validTags } = wanted.length
    ? await supabase.from("tags").select("id").eq("org_id", membership.orgId).in("id", wanted)
    : { data: [] as { id: string }[] };
  const validIds = (validTags ?? []).map((t) => t.id);

  const { data: before } = await supabase
    .from("conversation_tags")
    .select("tag_id")
    .eq("org_id", membership.orgId)
    .eq("conversation_id", parsed.data.conversationId);

  await supabase
    .from("conversation_tags")
    .delete()
    .eq("org_id", membership.orgId)
    .eq("conversation_id", parsed.data.conversationId);
  if (validIds.length) {
    const { error } = await supabase.from("conversation_tags").insert(
      validIds.map((tagId) => ({
        org_id: membership.orgId,
        conversation_id: parsed.data.conversationId,
        tag_id: tagId,
      })),
    );
    if (error) {
      console.error("[conversations] setConversationTags falhou:", error.code, error.message);
      return { error: "Não foi possível salvar as etiquetas." };
    }
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "conversation.tags_changed",
    resourceType: "conversations",
    resourceId: parsed.data.conversationId,
    before: { tag_ids: (before ?? []).map((t) => t.tag_id) },
    after: { tag_ids: validIds },
  });

  revalidatePath("/inbox", "layout");
  return {};
}

const newTagInput = z.object({
  conversationId: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome à etiqueta.").max(40, "Nome muito longo."),
});

/** Cria a etiqueta (ou reaproveita uma com o mesmo nome) e já coloca na conversa. */
export async function addNewTagToConversation(input: z.input<typeof newTagInput>): Promise<LabelActionResult> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }
  const parsed = newTagInput.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const supabase = await createClient();
  if (!(await conversationInOrg(supabase, parsed.data.conversationId, membership.orgId))) {
    return { error: "Conversa não encontrada." };
  }

  // Mesmo nome sem diferenciar maiúscula ("vip" = "VIP") — reaproveita em
  // vez de duplicar. %, _ e \ escapados: o nome vira texto literal no ILIKE.
  const { data: existing } = await supabase
    .from("tags")
    .select("id")
    .eq("org_id", membership.orgId)
    .ilike("name", parsed.data.name.replace(/[\\%_]/g, "\\$&"))
    .limit(1)
    .maybeSingle();

  let tagId = existing?.id as string | undefined;
  if (!tagId) {
    const { data: created, error } = await supabase
      .from("tags")
      .insert({ org_id: membership.orgId, name: parsed.data.name, color: colorForTag(parsed.data.name) })
      .select("id")
      .single();
    if (error || !created) {
      console.error("[conversations] criar etiqueta falhou:", error?.code, error?.message);
      return { error: "Não foi possível criar a etiqueta." };
    }
    tagId = created.id;
    await logAudit(supabase, {
      orgId: membership.orgId,
      actorId: membership.userId,
      action: "tag.created",
      resourceType: "tags",
      resourceId: tagId,
      after: { name: parsed.data.name },
    });
  }

  const { error: linkError } = await supabase
    .from("conversation_tags")
    .upsert(
      { org_id: membership.orgId, conversation_id: parsed.data.conversationId, tag_id: tagId },
      { onConflict: "conversation_id,tag_id" },
    );
  if (linkError) return { error: "Não foi possível adicionar a etiqueta." };

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "conversation.tags_changed",
    resourceType: "conversations",
    resourceId: parsed.data.conversationId,
    after: { added_tag_id: tagId },
  });

  revalidatePath("/inbox", "layout");
  revalidatePath("/funil");
  return {};
}
