import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { getContactsReport } from "@/lib/reports/contacts-report";
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
import { PeriodForm } from "../period-form";
import { PrintButton } from "../print-button";

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - 30);
  return { from: toDateInput(from), to: toDateInput(to) };
}

export default async function RelatorioContatosPage({
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
  const { rows, summary } = await getContactsReport(supabase, membership.orgId, from, to);

  const exportHref = `/contatos/export?from=${from}&to=${to}`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground">
          Base de contatos de {membership.orgName} — &quot;novos&quot; considera quem entrou entre{" "}
          {new Date(`${from}T00:00:00`).toLocaleDateString("pt-BR")} e{" "}
          {new Date(`${to}T00:00:00`).toLocaleDateString("pt-BR")}.
        </p>
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
            <CardDescription>Total de contatos</CardDescription>
            <CardTitle className="text-2xl">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Novos no período</CardDescription>
            <CardTitle className="text-2xl">{summary.newInPeriod}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Com opt-in</CardDescription>
            <CardTitle className="text-2xl text-positive">{summary.optedIn}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sem nenhum lead</CardDescription>
            <CardTitle className="text-2xl">{summary.withoutLead}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card className="print:border-none print:shadow-none">
        <CardHeader>
          <CardTitle>Base de contatos</CardTitle>
          <CardDescription>Um contato por linha — a base inteira, não só o período.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Telefone</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead>Opt-in</TableHead>
                <TableHead>Leads</TableHead>
                <TableHead>Cadastrado em</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="font-mono text-sm">{row.phone}</TableCell>
                  <TableCell className="text-sm">{row.email ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={row.optedIn ? "default" : "secondary"}>
                      {row.optedIn ? "sim" : "não"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{row.leadCount}</Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(row.createdAt).toLocaleDateString("pt-BR")}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nenhum contato ainda.
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
