"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/create";
import { updateConversationStatusSchema } from "@/lib/validation/conversations";

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

  revalidatePath("/inbox");
  revalidatePath(`/inbox/${parsed.data.conversationId}`);
  return null;
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
