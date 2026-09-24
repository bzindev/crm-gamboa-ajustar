import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";

type AdminClient = ReturnType<typeof createAdminClient>;

type SlaBreachRow = {
  conversation_id: string;
  org_id: string;
  assigned_to: string;
  contact_name: string | null;
  waited_minutes: number;
};

/**
 * Chamado pelo mesmo cron de 1 em 1 minuto que já drena o event_log (não
 * ganhou um cron próprio pra não esbarrar em limite de quantidade de crons
 * do Vercel). fn_sla_breaches já marca a conversa como notificada de forma
 * atômica (UPDATE ... RETURNING) — aqui só falta avisar quem precisa saber.
 */
export async function checkSlaBreaches(supabase: AdminClient): Promise<number> {
  const { data, error } = await supabase.rpc("fn_sla_breaches");
  if (error) {
    console.error("[sla] fn_sla_breaches falhou:", error.code, error.message);
    return 0;
  }

  const breaches = (data ?? []) as SlaBreachRow[];
  for (const breach of breaches) {
    await notifyBreach(supabase, breach);
  }
  return breaches.length;
}

async function notifyBreach(supabase: AdminClient, breach: SlaBreachRow) {
  const title = `SLA estourado: ${breach.contact_name ?? "cliente"}`;
  const body = `Aguardando resposta há ${breach.waited_minutes} min.`;
  const link = `/inbox/${breach.conversation_id}`;

  const { data: managers } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", breach.org_id)
    .in("role", ["manager", "admin", "owner"])
    .not("accepted_at", "is", null);

  // Vendedor responsável + todo gestor da organização — conjunto sem
  // duplicar (o responsável raramente também é gestor, mas pode ser).
  const recipients = new Set<string>([breach.assigned_to]);
  for (const m of managers ?? []) recipients.add(m.user_id);

  for (const userId of recipients) {
    await createNotification(supabase, {
      orgId: breach.org_id,
      userId,
      type: "conversation.sla_breach",
      title,
      body,
      link,
    });
  }
}
