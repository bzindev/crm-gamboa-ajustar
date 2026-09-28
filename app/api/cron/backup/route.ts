import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isCronAuthorized } from "@/lib/cron/auth";
import { runBackup } from "@/lib/backup/run-backup";

// Backup diário (vercel.json). Mesma proteção do outro cron: só com o
// Bearer CRON_SECRET.
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await runBackup(createAdminClient());
    return NextResponse.json({ ok: true, file: result.file, bytes: result.bytes, counts: result.counts, deleted: result.deleted.length });
  } catch (err) {
    console.error("[backup] falhou:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Backup falhou — veja o log do servidor." }, { status: 500 });
  }
}
