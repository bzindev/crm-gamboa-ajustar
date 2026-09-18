import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { getLeadsReport } from "@/lib/reports/leads-report";
import { formatCents } from "@/lib/format/currency";
import { TEMPERATURE_LABELS } from "@/lib/validation/leads";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Download } from "lucide-react";
import { PeriodForm } from "./period-form";
import { PrintButton } from "./print-button";

const STATUS_LABELS = { open: "Em aberto", won: "Ganho", lost: "Perdido" } as const;
const STATUS_VARIANT = {
  open: "secondary",
  won: "default",
  lost: "destructive",
} as const;

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: toDateInput(from), to: toDateInput(to) };
}

export default async function RelatoriosPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const params = await searchParams;
  const fallback = defaultRange();
  const from = params.from || fallback.from;
  const to = params.to || fallback.to;

  const supabase = await createClient();
  const { rows, summary } = await getLeadsReport(supabase, { orgId: membership.orgId, from, to });

  const exportHref = `/relatorios/export?from=${from}&to=${to}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Relatórios</h1>
          <p className="text-muted-foreground">
            Cartela de clientes que entraram em contato entre{" "}
            {new Date(`${from}T00:00:00`).toLocaleDateString("pt-BR")} e{" "}
            {new Date(`${to}T00:00:00`).toLocaleDateString("pt-BR")}.
          </p>
        </div>
        <div className="flex gap-2 print:hidden">
          <Button variant="outline" asChild>
            <a href={exportHref}>
              <Download className="size-4" />
              Exportar CSV
            </a>
          </Button>
          <PrintButton />
        </div>
      </div>

      <PeriodForm from={from} to={to} />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Leads no período</CardDescription>
            <CardTitle className="text-2xl">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Ganhos</CardDescription>
            <CardTitle className="text-2xl text-positive">{summary.won}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Perdidos</CardDescription>
            <CardTitle className="text-2xl text-destructive">{summary.lost}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valor em aberto</CardDescription>
            <CardTitle className="text-2xl">{formatCents(summary.openValueCents)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="print:border-none print:shadow-none">
        <CardHeader>
          <CardTitle>Cartela de clientes</CardTitle>
          <CardDescription>
            Um lead por linha — mesmo cliente pode aparecer mais de uma vez se abriu mais de um
            contato no período.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>Etapa</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Temp.</TableHead>
                <TableHead>Responsável</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">
                    {new Date(row.createdAt).toLocaleDateString("pt-BR")}
                  </TableCell>
                  <TableCell className="font-medium">{row.contactName}</TableCell>
                  <TableCell className="font-mono text-sm">{row.contactPhone}</TableCell>
                  <TableCell>{row.title}</TableCell>
                  <TableCell>{row.stageName}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[row.status]}>{STATUS_LABELS[row.status]}</Badge>
                  </TableCell>
                  <TableCell>{TEMPERATURE_LABELS[row.temperature]}</TableCell>
                  <TableCell>{row.ownerName ?? "—"}</TableCell>
                  <TableCell>{row.teamName ?? "—"}</TableCell>
                  <TableCell className="text-right">{formatCents(row.valueCents)}</TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-muted-foreground">
                    Nenhum lead neste período.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
