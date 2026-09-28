"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";

export type CsatActionState = { error?: string; success?: true } | null;

const csatSettingsSchema = z.object({
  enabled: z.boolean(),
  message: z.string().trim().min(10, "Escreva a pergunta.").max(600, "Mensagem muito longa."),
});

export async function updateCsatSettings(
  _prevState: CsatActionState,
  formData: FormData,
): Promise<CsatActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = csatSettingsSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    message: formData.get("message"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ csat_enabled: parsed.data.enabled, csat_message: parsed.data.message })
    .eq("id", membership.orgId);
  if (error) {
    console.error("[csat] updateCsatSettings falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "organization.csat_updated",
    resourceType: "organizations",
    resourceId: membership.orgId,
    after: { csat_enabled: parsed.data.enabled },
  });

  revalidatePath("/configuracoes/geral");
  return { success: true };
}
