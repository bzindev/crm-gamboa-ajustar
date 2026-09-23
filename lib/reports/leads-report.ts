import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { TEMPERATURE_LABELS } from "@/lib/validation/leads";
import { csvEscape } from "@/lib/reports/csv";

export type LeadsReportFilters = {
  orgId: string;
  from: string; // yyyy-mm-dd, início do período (inclusive)
  to: string; // yyyy-mm-dd, fim do período (inclusive)
};

export type LeadsReportRow = {
  id: string;
  createdAt: string;
  title: string;
  contactName: string;
  contactPhone: string;
  stageName: string;
  status: "open" | "won" | "lost";
  temperature: "cold" | "warm" | "hot";
  origin: string | null;
  campaign: string | null;
  ownerName: string | null;
  teamName: string | null;
  valueCents: number | null;
};

export type LeadsReportSummary = {
  total: number;
  won: number;
  lost: number;
  openValueCents: number;
};

type LeadRow = {
  id: string;
  created_at: string;
  title: string;
  status: "open" | "won" | "lost";
  temperature: "cold" | "warm" | "hot";
  origin: string | null;
  campaign: string | null;
  value_cents: number | null;
  contacts: { name: string; phone_e164: string } | { name: string; phone_e164: string }[] | null;
  pipeline_stages: { name: string } | { name: string }[] | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
  teams: { name: string } | { name: string }[] | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

// Cartela de clientes que entraram em contato no período: hoje "entrar em
// contato" é o cadastro manual do lead (sem WhatsApp conectado ainda), por
// isso o filtro é por leads.created_at. Quando o Inbox estiver ligado, isso
// passa a refletir a criação automática do lead a partir da primeira
// mensagem recebida — sem mudar esta consulta.
export async function getLeadsReport(
  supabase: SupabaseClient,
  { orgId, from, to }: LeadsReportFilters,
): Promise<{ rows: LeadsReportRow[]; summary: LeadsReportSummary }> {
  const { data } = await supabase
    .from("leads")
    .select(
      "id, created_at, title, status, temperature, origin, campaign, value_cents, contacts(name, phone_e164), pipeline_stages(name), profiles(full_name), teams(name)",
    )
    .eq("org_id", orgId)
    .gte("created_at", `${from}T00:00:00.000Z`)
    .lte("created_at", `${to}T23:59:59.999Z`)
    .order("created_at", { ascending: false })
    .returns<LeadRow[]>();

  const rows: LeadsReportRow[] = (data ?? []).map((lead) => {
    const contact = one(lead.contacts);
    const stage = one(lead.pipeline_stages);
    const owner = one(lead.profiles);
    const team = one(lead.teams);

    return {
      id: lead.id,
      createdAt: lead.created_at,
      title: lead.title,
      contactName: contact?.name ?? "—",
      contactPhone: contact?.phone_e164 ?? "—",
      stageName: stage?.name ?? "—",
      status: lead.status,
      temperature: lead.temperature,
      origin: lead.origin,
      campaign: lead.campaign,
      ownerName: owner?.full_name ?? null,
      teamName: team?.name ?? null,
      valueCents: lead.value_cents,
    };
  });

  const summary: LeadsReportSummary = {
    total: rows.length,
    won: rows.filter((r) => r.status === "won").length,
    lost: rows.filter((r) => r.status === "lost").length,
    openValueCents: rows
      .filter((r) => r.status === "open")
      .reduce((sum, r) => sum + (r.valueCents ?? 0), 0),
  };

  return { rows, summary };
}

const STATUS_LABELS: Record<LeadsReportRow["status"], string> = {
  open: "Em aberto",
  won: "Ganho",
  lost: "Perdido",
};

export function leadsReportToCsv(rows: LeadsReportRow[]): string {
  const header = [
    "Data",
    "Cliente",
    "Telefone",
    "Lead",
    "Etapa",
    "Status",
    "Temperatura",
    "Origem",
    "Campanha",
    "Responsável",
    "Setor",
    "Valor (R$)",
  ];

  const lines = rows.map((row) =>
    [
      new Date(row.createdAt).toLocaleDateString("pt-BR"),
      row.contactName,
      row.contactPhone,
      row.title,
      row.stageName,
      STATUS_LABELS[row.status],
      TEMPERATURE_LABELS[row.temperature],
      row.origin ?? "",
      row.campaign ?? "",
      row.ownerName ?? "",
      row.teamName ?? "",
      row.valueCents != null ? (row.valueCents / 100).toFixed(2).replace(".", ",") : "",
    ]
      .map((cell) => csvEscape(String(cell)))
      .join(";"),
  );

  // BOM no início: Excel no Windows só reconhece UTF-8 sem isso mostrar
  // acentuação quebrada ao abrir o CSV direto.
  return "﻿" + [header.join(";"), ...lines].join("\n");
}
