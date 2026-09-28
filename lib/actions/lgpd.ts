"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";

export type LgpdActionState = { error?: string; success?: true } | null;

/** Direito ao esquecimento — irreversível. Regra de quem pode fica no banco (migration 0026). */
export async function anonymizeContact(
  _prevState: LgpdActionState,
  formData: FormData,
): Promise<LgpdActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = z.string().uuid().safeParse(formData.get("contactId"));
  if (!parsed.success) return { error: "Contato inválido." };

  const supabase = await createClient();
  const { error } = await supabase.rpc("fn_anonymize_contact", {
    p_org_id: membership.orgId,
    p_contact_id: parsed.data,
  });

  if (error) {
    if (error.message.includes("mfa_required")) return { error: "Confirme o código do 2FA (saia e entre de novo) antes de fazer isso." };
    if (error.message.includes("forbidden")) return { error: "Só administradores podem anonimizar contatos." };
    if (error.message.includes("not_found")) return { error: "Contato não encontrado." };
    console.error("[lgpd] anonymizeContact falhou:", error.code, error.message);
    return { error: "Não foi possível anonimizar." };
  }

  // Sem nome/telefone no registro — seria gravar de volta o dado que
  // acabou de ser apagado.
  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "contact.anonymized",
    resourceType: "contacts",
    resourceId: parsed.data,
  });

  revalidatePath(`/contatos/${parsed.data}`);
  revalidatePath("/contatos");
  return { success: true };
}

const retentionSchema = z.union([
  z.literal(""),
  z.coerce.number().int().min(6, "Mínimo de 6 meses.").max(120, "Máximo de 120 meses."),
]);

export async function updateRetention(
  _prevState: LgpdActionState,
  formData: FormData,
): Promise<LgpdActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = retentionSchema.safeParse(formData.get("retentionMonths") ?? "");
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Valor inválido." };
  const months = parsed.data === "" ? null : parsed.data;

  const supabase = await createClient();
  const { error } = await supabase.from("organizations").update({ retention_months: months }).eq("id", membership.orgId);
  if (error) {
    console.error("[lgpd] updateRetention falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "organization.retention_updated",
    resourceType: "organizations",
    resourceId: membership.orgId,
    after: { retention_months: months },
  });

  revalidatePath("/configuracoes/geral");
  return { success: true };
}
