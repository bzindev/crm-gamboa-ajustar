"use server";

import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/log";

/**
 * Ativar/desativar o 2FA acontece no navegador, direto com o Supabase Auth
 * (o segredo do app autenticador nunca passa pelo nosso servidor). Depois
 * disso o navegador chama esta ação só pra deixar registrado — e ela
 * confere o estado real no servidor em vez de acreditar no que o cliente
 * diz que aconteceu.
 */
export async function recordMfaChange(kind: "enabled" | "disabled"): Promise<void> {
  const membership = await getActiveOrgMembership();
  if (!membership) return;

  const supabase = await createClient();
  const { data } = await supabase.auth.mfa.listFactors();
  const hasVerified = (data?.totp ?? []).some((f) => f.status === "verified");
  if ((kind === "enabled") !== hasVerified) return;

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: kind === "enabled" ? "security.mfa_enabled" : "security.mfa_disabled",
    resourceType: "profiles",
    resourceId: membership.userId,
  });
}
