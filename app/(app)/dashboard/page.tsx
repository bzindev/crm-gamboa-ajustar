import { redirect } from "next/navigation";
import {
  Users,
  Wallet,
  TrendingUp,
  TrendingDown,
  KanbanSquare,
  Percent,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { getDefaultPipelineId } from "@/lib/crm/pipeline";
import { formatCents } from "@/lib/format/currency";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import Link from "next/link";

type Period = "month" | "all";

function metricIconClass() {
  return "size-4 text-muted-foreground";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const { period: rawPeriod } = await searchParams;
  const period: Period = rawPeriod === "all" ? "all" : "month";

  const supabase = await createClient();
  const pipelineId = await getDefaultPipelineId(supabase, membership.orgId);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [{ data: stages }, { data: leads }, { data: contacts }, { data: channels }, { data: members }] =
    await Promise.all([
      supabase
        .from("pipeline_stages")
        .select("id, name, position")
        .eq("pipeline_id", pipelineId)
        .order("position", { ascending: true }),
      supabase
        .from("leads")
        .select(
          "id, title, stage_id, value_cents, status, owner_id, lost_reason, created_at, updated_at",
        )
        .eq("pipeline_id", pipelineId),
      supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", membership.orgId),
      supabase.from("channels").select("id").eq("org_id", membership.orgId).limit(1),
      supabase
        .from("org_members")
        .select("user_id, profiles(full_name)")
        .eq("org_id", membership.orgId)
        .not("accepted_at", "is", null),
    ]);

  const allLeads = leads ?? [];
  const openLeads = allLeads.filter((l) => l.status === "open");
  const totalOpenCents = openLeads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);

  const byStage = (stages ?? []).map((stage) => {
    const stageLeads = openLeads.filter((l) => l.stage_id === stage.id);
    return {
      id: stage.id,
      name: stage.name,
      count: stageLeads.length,
      valueCents: stageLeads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0),
    };
  });

  const inPeriod = (dateStr: string) => period === "all" || new Date(dateStr) >= startOfMonth;

  const createdInPeriod = allLeads.filter((l) => inPeriod(l.created_at)).length;
  const wonInPeriod = allLeads.filter((l) => l.status === "won" && inPeriod(l.updated_at));
  const lostInPeriod = allLeads.filter((l) => l.status === "lost" && inPeriod(l.updated_at));
  const closedCount = wonInPeriod.length + lostInPeriod.length;
  const conversionRate = closedCount > 0 ? Math.round((wonInPeriod.length / closedCount) * 100) : null;

  const memberNameById = new Map(
    (members ?? []).map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return [m.user_id, profile?.full_name ?? "(sem nome)"];
    }),
  );

  const byOwner = new Map<string, { name: string; count: number; valueCents: number }>();
  for (const lead of openLeads) {
    const ownerId = lead.owner_id ?? "sem-responsavel";
    const name = lead.owner_id ? memberNameById.get(lead.owner_id) ?? "(sem nome)" : "Sem responsável";
    const current = byOwner.get(ownerId) ?? { name, count: 0, valueCents: 0 };
    current.count += 1;
    current.valueCents += lead.value_cents ?? 0;
    byOwner.set(ownerId, current);
  }
  const ownerBreakdown = [...byOwner.values()].sort((a, b) => b.count - a.count);

  const lostReasonCounts = new Map<string, number>();
  for (const lead of lostInPeriod) {
    const reason = lead.lost_reason?.trim() || "Sem motivo registrado";
    lostReasonCounts.set(reason, (lostReasonCounts.get(reason) ?? 0) + 1);
  }
  const topLostReasons = [...lostReasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  const recentLeads = [...allLeads]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const hasChannel = (channels?.length ?? 0) > 0;
  const maxStageCount = Math.max(1, ...byStage.map((s) => s.count));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Olá!</h1>
          <p className="text-muted-foreground">
            Você está em <strong>{membership.orgName}</strong>.
          </p>
        </div>
        <div className="flex gap-1 rounded-md border p-1">
          <Button asChild variant={period === "month" ? "default" : "ghost"} size="sm">
            <Link href="/dashboard?period=month">Este mês</Link>
          </Button>
          <Button asChild variant={period === "all" ? "default" : "ghost"} size="sm">
            <Link href="/dashboard?period=all">Total</Link>
          </Button>
        </div>
      </div>

      {!hasChannel && (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Nenhum canal de WhatsApp conectado ainda — métricas de
            atendimento aparecem aqui quando isso acontecer.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Leads em aberto</CardDescription>
            <KanbanSquare className={metricIconClass()} />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{openLeads.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Valor em aberto</CardDescription>
            <Wallet className={metricIconClass()} />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{formatCents(totalOpenCents)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Contatos cadastrados</CardDescription>
            <Users className={metricIconClass()} />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{contacts?.length ?? 0}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Leads criados</CardDescription>
            <KanbanSquare className={metricIconClass()} />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{createdInPeriod}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Ganhos</CardDescription>
            <TrendingUp className="size-4 text-primary" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{wonInPeriod.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Perdidos</CardDescription>
            <TrendingDown className="size-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{lostInPeriod.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Taxa de conversão</CardDescription>
            <Percent className={metricIconClass()} />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">
              {conversionRate === null ? "—" : `${conversionRate}%`}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leads por etapa</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {byStage.map((stage) => (
              <div key={stage.id} className="flex items-center gap-3">
                <span className="w-28 shrink-0 truncate text-sm">{stage.name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(stage.count / maxStageCount) * 100}%` }}
                  />
                </div>
                <span className="w-10 shrink-0 text-right text-sm text-muted-foreground">
                  {stage.count}
                </span>
              </div>
            ))}
            {byStage.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma etapa configurada.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Leads por responsável</CardTitle>
            <CardDescription>Só leads em aberto (carga de trabalho atual).</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {ownerBreakdown.map((owner) => (
              <div
                key={owner.name}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{owner.name}</span>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{owner.count} leads</span>
                  <span>·</span>
                  <span>{formatCents(owner.valueCents)}</span>
                </div>
              </div>
            ))}
            {ownerBreakdown.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum lead em aberto ainda.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leads recentes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{lead.title}</span>
                <div className="flex items-center gap-2">
                  <Badge variant={lead.status === "open" ? "secondary" : "outline"}>
                    {lead.status === "open" ? "em aberto" : lead.status === "won" ? "ganho" : "perdido"}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{formatCents(lead.value_cents)}</span>
                </div>
              </div>
            ))}
            {recentLeads.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nenhum lead ainda — crie o primeiro no Funil.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Motivos de perda</CardTitle>
            <CardDescription>
              {period === "month" ? "Este mês." : "Todo o histórico."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {topLostReasons.map(([reason, count]) => (
              <div
                key={reason}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span className="truncate">{reason}</span>
                <Badge variant="outline">{count}</Badge>
              </div>
            ))}
            {topLostReasons.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum lead perdido no período.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
