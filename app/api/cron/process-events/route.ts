import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingEvents } from "@/lib/whatsapp/process-events";
import { checkSlaBreaches } from "@/lib/whatsapp/sla-check";
import { checkResponseBreaches } from "@/lib/whatsapp/reassignment-check";
import { checkStageAlerts } from "@/lib/crm/stage-alert-check";
import { checkRetention } from "@/lib/crm/retention-check";
import { processPendingCsat } from "@/lib/whatsapp/csat-worker";
import { isCronAuthorized } from "@/lib/cron/auth";

// Chamado pelo Vercel Cron (ou um cron manual em outro provedor) — nunca
// pelo navegador. CRON_SECRET no header Authorization é o único controle de
// acesso; sem ele, qualquer um poderia disparar o worker.
export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = createAdminClient();
  const result = await processPendingEvents(supabase);
  // Mesmo cron de 1 em 1 minuto, não um cron separado — cada checagem é uma
  // função no banco, leve, sem precisar de agendamento próprio.
  const slaBreaches = await checkSlaBreaches(supabase);
  const reassigned = await checkResponseBreaches(supabase);
  const stageAlerts = await checkStageAlerts(supabase);
  const anonymized = await checkRetention(supabase);
  const csatSent = await processPendingCsat(supabase);

  return NextResponse.json({ ...result, slaBreaches, reassigned, stageAlerts, anonymized, csatSent });
}
