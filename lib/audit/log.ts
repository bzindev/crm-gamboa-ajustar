import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fire-and-forget: se a escrita de auditoria falhar, a mutação principal
 * não é desfeita (não faz sentido perder o dado do usuário por causa de um
 * log), mas o erro aparece no console do servidor para investigação. Ver
 * ARCHITECTURE.md — auditoria é responsabilidade do código da aplicação,
 * não de trigger, para ficar fácil de acompanhar o que gerou cada linha.
 */
export async function logAudit(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    actorId: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    org_id: params.orgId,
    actor_id: params.actorId,
    action: params.action,
    resource_type: params.resourceType,
    resource_id: params.resourceId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
  });

  if (error) {
    console.error("[audit] falha ao gravar audit_log:", error.code, error.message);
  }
}
