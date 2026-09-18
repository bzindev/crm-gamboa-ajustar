import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processPendingEvents } from "@/lib/whatsapp/process-events";

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

  return NextResponse.json(result);
}
