"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { monthKeyToDate } from "@/lib/crm/goals";

export type GoalActionState = { error?: string; success?: true } | null;

const goalSchema = z.object({
  userId: z.union([z.string().uuid(), z.literal("")]),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mês inválido."),
  targetWon: z.coerce.number().int().min(1, "A meta precisa ser de pelo menos 1 venda.").max(10000),
  targetValueReais: z.union([z.coerce.number().positive("Valor precisa ser positivo.").max(1e9), z.literal("")]),
});

export async function saveGoal(_prevState: GoalActionState, formData: FormData): Promise<GoalActionState> {
  let membership;
  try {
    membership = await requireRole("manager");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = goalSchema.safeParse({
    userId: formData.get("userId") ?? "",
    month: formData.get("month"),
    targetWon: formData.get("targetWon"),
    targetValueReais: formData.get("targetValueReais") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const userId = parsed.data.userId || null;

  if (userId) {
    const { data: member } = await supabase
      .from("org_members")
      .select("user_id")
      .eq("org_id", membership.orgId)
      .eq("user_id", userId)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!member) return { error: "Essa pessoa não faz parte da organização." };
  }

  const row = {
    org_id: membership.orgId,
    user_id: userId,
    month: monthKeyToDate(parsed.data.month),
    target_won: parsed.data.targetWon,
    target_value_cents:
      parsed.data.targetValueReais === "" ? null : Math.round(parsed.data.targetValueReais * 100),
    created_by: membership.userId,
  };

  // Mesmo vendedor + mesmo mês = atualiza a meta existente em vez de duplicar.
  const { data, error } = await supabase
    .from("goals")
    .upsert(row, { onConflict: "org_id,user_id,month" })
    .select("id")
    .single();

  if (error) {
    console.error("[goals] saveGoal falhou:", error.code, error.message);
    return { error: "Não foi possível salvar a meta." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "goal.saved",
    resourceType: "goals",
    resourceId: data.id,
    after: { user_id: userId, month: row.month, target_won: row.target_won, target_value_cents: row.target_value_cents },
  });

  revalidatePath("/configuracoes/metas");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteGoal(formData: FormData): Promise<void> {
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
    .from("goals")
    .delete()
    .eq("id", parsed.data)
    .eq("org_id", membership.orgId)
    .select("user_id, month, target_won")
    .maybeSingle();
  if (!data) return;

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "goal.deleted",
    resourceType: "goals",
    resourceId: parsed.data,
    before: data,
  });

  revalidatePath("/configuracoes/metas");
  revalidatePath("/dashboard");
}
