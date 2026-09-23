import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { csvEscape } from "@/lib/reports/csv";

export type ContactReportRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  optedIn: boolean;
  leadCount: number;
  createdAt: string;
};

export type ContactReportSummary = {
  total: number;
  newInPeriod: number;
  optedIn: number;
  withoutLead: number;
};

// Diferente do relatório de leads (que é por período), a tabela aqui é a
// base inteira de contatos — "novos no período" é só mais uma métrica, não
// um filtro da lista. Faz mais sentido pra um relatório de base de
// clientes: você quer ver quem já está cadastrado, não só quem entrou
// numa janela de tempo específica.
export async function getContactsReport(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<{ rows: ContactReportRow[]; summary: ContactReportSummary }> {
  const [{ data: contacts }, { data: leads }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, phone_e164, email, opted_in, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false }),
    supabase.from("leads").select("contact_id").eq("org_id", orgId),
  ]);

  const leadCountByContact = new Map<string, number>();
  for (const lead of leads ?? []) {
    leadCountByContact.set(lead.contact_id, (leadCountByContact.get(lead.contact_id) ?? 0) + 1);
  }

  const rows: ContactReportRow[] = (contacts ?? []).map((c) => ({
    id: c.id,
    name: c.name ?? c.phone_e164,
    phone: c.phone_e164,
    email: c.email,
    optedIn: c.opted_in,
    leadCount: leadCountByContact.get(c.id) ?? 0,
    createdAt: c.created_at,
  }));

  const fromTime = new Date(`${from}T00:00:00.000Z`).getTime();
  const toTime = new Date(`${to}T23:59:59.999Z`).getTime();

  const summary: ContactReportSummary = {
    total: rows.length,
    newInPeriod: rows.filter((r) => {
      const t = new Date(r.createdAt).getTime();
      return t >= fromTime && t <= toTime;
    }).length,
    optedIn: rows.filter((r) => r.optedIn).length,
    withoutLead: rows.filter((r) => r.leadCount === 0).length,
  };

  return { rows, summary };
}

export function contactsReportToCsv(rows: ContactReportRow[]): string {
  const header = ["Nome", "Telefone", "E-mail", "Opt-in", "Leads", "Cadastrado em"];
  const lines = rows.map((row) =>
    [
      row.name,
      row.phone,
      row.email ?? "",
      row.optedIn ? "sim" : "não",
      String(row.leadCount),
      new Date(row.createdAt).toLocaleDateString("pt-BR"),
    ]
      .map((cell) => csvEscape(String(cell)))
      .join(";"),
  );
  return "﻿" + [header.join(";"), ...lines].join("\n");
}
