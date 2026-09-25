import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingEvents } from "@/lib/whatsapp/process-events";
import { checkSlaBreaches } from "@/lib/whatsapp/sla-check";
import { checkResponseBreaches } from "@/lib/whatsapp/reassignment-check";
import { checkStageAlerts } from "@/lib/crm/stage-alert-check";

// Chamado pelo Vercel Cron (ou um cron manual em outro provedor) — nunca
// pelo navegador. CRON_SECRET no header Authorization é o único controle de
// acesso; sem ele, qualquer um poderia disparar o worker.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const result = await processPendingEvents(supabase);
  // Mesmo cron de 1 em 1 minuto, não um cron separado — checagem de SLA e
  // de reatribuição são leves (uma função no banco cada) e não precisam de
  // agendamento próprio.
  const slaBreaches = await checkSlaBreaches(supabase);
  const reassigned = await checkResponseBreaches(supabase);
  const stageAlerts = await checkStageAlerts(supabase);

  return NextResponse.json({ ...result, slaBreaches, reassigned, stageAlerts });
}
