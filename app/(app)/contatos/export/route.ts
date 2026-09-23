import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { getContactsReport, contactsReportToCsv } from "@/lib/reports/contacts-report";

const querySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

// GET em vez de Server Action — o navegador precisa de uma URL que ele
// mesmo baixe como arquivo (Content-Disposition). Mesmo padrão de
// app/(app)/relatorios/export/route.ts.
export async function GET(request: NextRequest) {
  const membership = await getActiveOrgMembership();
  if (!membership) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }

  const parsed = querySchema.safeParse({
    from: request.nextUrl.searchParams.get("from"),
    to: request.nextUrl.searchParams.get("to"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Período inválido." }, { status: 400 });
  }

  const supabase = await createClient();
  const { rows } = await getContactsReport(supabase, membership.orgId, parsed.data.from, parsed.data.to);

  const csv = contactsReportToCsv(rows);

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"contatos.csv\"",
    },
  });
}
