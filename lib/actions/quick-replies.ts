"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { quickReplySchema } from "@/lib/validation/quick-replies";

export type QuickReplyActionState = { error?: string; success?: true } | null;

// Gerente+ mantém a lista; qualquer vendedor só usa (leitura via RLS).
export async function createQuickReply(
  _prevState: QuickReplyActionState,
  formData: FormData,
): Promise<QuickReplyActionState> {
  let membership;
  try {
    membership = await requireRole("manager");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = quickReplySchema.safeParse({ title: formData.get("title"), body: formData.get("body") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("quick_replies")
    .insert({ org_id: membership.orgId, title: parsed.data.title, body: parsed.data.body, created_by: membership.userId })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Já existe uma resposta rápida com esse nome." };
    console.error("[quick-replies] create falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "quick_reply.created",
    resourceType: "quick_replies",
    resourceId: data.id,
    after: { title: parsed.data.title },
  });

  revalidatePath("/configuracoes/respostas-rapidas");
  return { success: true };
}

export async function deleteQuickReply(formData: FormData): Promise<void> {
  let membership;
  try {
    membership = await requireRole("manager");
  } catch {
    return;
  }

  const parsed = z.string().uuid().safeParse(formData.get("id"));
  if (!parsed.success) return;

  const supabase = await createClient();
  const { data } = await supabase
    .from("quick_replies")
    .delete()
    .eq("id", parsed.data)
    .eq("org_id", membership.orgId)
    .select("title")
    .maybeSingle();
  if (!data) return;

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "quick_reply.deleted",
    resourceType: "quick_replies",
    resourceId: parsed.data,
    before: { title: data.title },
  });

  revalidatePath("/configuracoes/respostas-rapidas");
}
