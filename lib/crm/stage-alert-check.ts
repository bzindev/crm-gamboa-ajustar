import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";

type AdminClient = ReturnType<typeof createAdminClient>;

type StageAlertRow = {
  lead_id: string;
  org_id: string;
  owner_id: string;
  title: string;
  contact_id: string | null;
  days_stuck: number;
};

/**
 * Chamado pelo mesmo cron de 1 em 1 minuto de sempre. O "lead parado" já
 * existia como indicador visual (Dashboard/Funil, `stage_alert_days`) —
 * isso só faz a mesma regra também virar uma notificação de verdade pro
 * responsável, em vez de precisar abrir o Funil pra reparar.
 */
export async function checkStageAlerts(supabase: AdminClient): Promise<number> {
  const { data, error } = await supabase.rpc("fn_stage_alert_breaches");
  if (error) {
    console.error("[stage-alert] fn_stage_alert_breaches falhou:", error.code, error.message);
    return 0;
  }

  const rows = (data ?? []) as StageAlertRow[];
  for (const row of rows) {
    await notifyStalled(supabase, row);
  }
  return rows.length;
}

async function notifyStalled(supabase: AdminClient, row: StageAlertRow) {
  // Abre a conversa direto se já existir uma com esse contato — mesma
  // lógica de lib/actions/leads.ts pras notificações de lead atribuído.
  let link = "/funil";
  if (row.contact_id) {
    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("org_id", row.org_id)
      .eq("contact_id", row.contact_id)
      .limit(1)
      .maybeSingle();
    if (conversation) link = `/inbox/${conversation.id}`;
  }

  await createNotification(supabase, {
    orgId: row.org_id,
    userId: row.owner_id,
    type: "lead.stage_stalled",
    title: "Lead parado, hora do follow-up",
    body: `${row.title} · ${row.days_stuck} dia${row.days_stuck === 1 ? "" : "s"} sem avançar de etapa`,
    link,
  });
}
