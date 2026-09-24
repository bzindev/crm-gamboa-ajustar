"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/log";
import { updateConversationStatusSchema } from "@/lib/validation/conversations";

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
