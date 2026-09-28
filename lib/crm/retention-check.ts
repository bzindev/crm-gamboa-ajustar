import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { logAudit } from "@/lib/audit/log";

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * Retenção automática (LGPD) — só age em organização que ligou
 * `retention_months` (padrão desligado). Lote pequeno por execução: o cron
 * roda a cada minuto, então um acúmulo grande se resolve em poucas rodadas
 * sem uma execução longa travar as outras checagens.
 */
export async function checkRetention(supabase: AdminClient): Promise<number> {
  const { data, error } = await supabase.rpc("fn_retention_sweep", { p_limit: 100 });
  if (error) {
    console.error("[retention] fn_retention_sweep falhou:", error.code, error.message);
    return 0;
  }

  const rows = (data ?? []) as { org_id: string; contact_id: string }[];
  for (const row of rows) {
    await logAudit(supabase, {
      orgId: row.org_id,
      actorId: null,
      action: "contact.anonymized_by_retention",
      resourceType: "contacts",
      resourceId: row.contact_id,
    });
  }
  return rows.length;
}
