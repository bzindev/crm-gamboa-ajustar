import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Users,
  Wallet,
  TrendingUp,
  TrendingDown,
  KanbanSquare,
  Percent,
  Flame,
  AlertTriangle,
  BarChart3,
  Zap,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { getDefaultPipelineId } from "@/lib/crm/pipeline";
import { formatCents } from "@/lib/format/currency";
import { getInitials } from "@/lib/format/initials";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

type Period = "month" | "all";

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 100);
}

function KpiCard({
  icon: Icon,
  variant,
  label,
  value,
  delta,
  progressPct,
}: {
  icon: React.ComponentType<{ className?: string }>;
  variant: "dark" | "yellow";
  label: string;
  value: string;
  delta: number | null;
  progressPct: number;
}) {
  return (
    <Card>
      <CardContent className="pt-1">
        <div className="flex items-start justify-between">
          <div
            className={cn(
              "flex size-10 items-center justify-center rounded-full",
              variant === "dark" ? "bg-white text-[#18181b]" : "bg-primary text-primary-foreground",
            )}
          >
            <Icon className="size-5" />
          </div>
          {delta !== null && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                delta >= 0 ? "bg-accent text-accent-foreground" : "bg-destructive/10 text-destructive",
              )}
            >
              {delta >= 0 ? "+" : ""}
              {delta}%
            </span>
          )}
        </div>
        <p className="mt-4 text-2xl font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.min(100, Math.max(4, progressPct))}%` }}
          />
        </div>
        {delta !== null && <p className="mt-1.5 text-[11px] text-muted-foreground">vs mês passado</p>}
      </CardContent>
    </Card>
  );
}

const QUICK_ACTIONS = [
  { href: "/funil", label: "Ver Funil", sub: "Kanban de vendas", icon: KanbanSquare, className: "bg-primary text-primary-foreground" },
  { href: "/contatos", label: "Contatos", sub: "Base de clientes", icon: Users, className: "bg-white text-[#18181b]" },
  { href: "/relatorios", label: "Relatórios", sub: "Exportar dados", icon: BarChart3, className: "bg-zinc-700 text-white" },
  { href: "/automacoes", label: "Automações", sub: "Configurar alertas", icon: Zap, className: "bg-[#ca8a04] text-white" },
];

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

  const startOfPrevMonth = new Date(startOfMonth);
  startOfPrevMonth.setMonth(startOfPrevMonth.getMonth() - 1);

  const [
    { data: stages },
    { data: leads },
    { data: contacts },
    { data: channels },
    { data: members },
    { data: org },
  ] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, name, position")
      .eq("pipeline_id", pipelineId)
      .order("position", { ascending: true }),
    supabase
      .from("leads")
      .select(
        "id, title, stage_id, value_cents, status, owner_id, lost_reason, temperature, stage_entered_at, created_at, updated_at",
      )
      .eq("pipeline_id", pipelineId),
    supabase.from("contacts").select("id", { count: "exact", head: true }).eq("org_id", membership.orgId),
    supabase.from("channels").select("id").eq("org_id", membership.orgId).limit(1),
    supabase
      .from("org_members")
      .select("user_id, profiles(full_name)")
      .eq("org_id", membership.orgId)
      .not("accepted_at", "is", null),
    supabase.from("organizations").select("stage_alert_days").eq("id", membership.orgId).single(),
  ]);

  const allLeads = leads ?? [];
  const openLeads = allLeads.filter((l) => l.status === "open");
  const totalOpenCents = openLeads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);
  const hotLeadsCount = openLeads.filter((l) => l.temperature === "hot").length;

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
  const inPrevMonth = (dateStr: string) => {
    const d = new Date(dateStr);
    return d >= startOfPrevMonth && d < startOfMonth;
  };

  const createdInPeriod = allLeads.filter((l) => inPeriod(l.created_at)).length;
  const wonInPeriod = allLeads.filter((l) => l.status === "won" && inPeriod(l.updated_at));
  const lostInPeriod = allLeads.filter((l) => l.status === "lost" && inPeriod(l.updated_at));
  const closedCount = wonInPeriod.length + lostInPeriod.length;
  const conversionRate = closedCount > 0 ? Math.round((wonInPeriod.length / closedCount) * 100) : null;

  // Comparação com o mês anterior — só faz sentido no recorte "este mês".
  const showDelta = period === "month";
  const createdPrevMonth = allLeads.filter((l) => inPrevMonth(l.created_at)).length;
  const wonPrevMonth = allLeads.filter((l) => l.status === "won" && inPrevMonth(l.updated_at)).length;
  const lostPrevMonth = allLeads.filter((l) => l.status === "lost" && inPrevMonth(l.updated_at)).length;
  const conversionPrevMonth =
    wonPrevMonth + lostPrevMonth > 0 ? Math.round((wonPrevMonth / (wonPrevMonth + lostPrevMonth)) * 100) : null;

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
  const topLostReasons = [...lostReasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

  const recentLeads = [...allLeads]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  const stageAlertDays = org?.stage_alert_days ?? 3;
  const stageNameById = new Map((stages ?? []).map((s) => [s.id, s.name]));
  const stuckLeads = openLeads
    .map((l) => ({ ...l, daysInStage: daysSince(l.stage_entered_at) }))
    .filter((l) => l.daysInStage >= stageAlertDays)
    .sort((a, b) => b.daysInStage - a.daysInStage)
    .slice(0, 8);

  const hasChannel = (channels?.length ?? 0) > 0;
  const maxStageCount = Math.max(1, ...byStage.map((s) => s.count));
  const today = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="flex flex-col gap-6">
      {/* Banner de boas-vindas */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#0d0d0d] to-[#3f2d0a] p-6 text-white ring-1 ring-white/10 sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold sm:text-3xl">Bem-vindo de volta 👋</h1>
            <p className="mt-1 text-sm text-white/60">
              Você está em <span className="font-medium text-white/80">{membership.orgName}</span>.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/20 px-3 py-1.5 text-xs font-medium text-primary">
              {today}
            </span>
            <div className="flex gap-1 rounded-full bg-white/10 p-1">
              <Button
                asChild
                size="sm"
                variant={period === "month" ? "default" : "ghost"}
                className={period === "month" ? "" : "text-white hover:bg-white/10 hover:text-white"}
              >
                <Link href="/dashboard?period=month">Este mês</Link>
              </Button>
              <Button
                asChild
                size="sm"
                variant={period === "all" ? "default" : "ghost"}
                className={period === "all" ? "" : "text-white hover:bg-white/10 hover:text-white"}
              >
                <Link href="/dashboard?period=all">Total</Link>
              </Button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-primary">
              <KanbanSquare className="size-4" />
              <span className="text-xs text-white/60">Leads em aberto</span>
            </div>
            <p className="mt-2 text-2xl font-bold">{openLeads.length}</p>
          </div>
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-primary">
              <Wallet className="size-4" />
              <span className="text-xs text-white/60">Valor em aberto</span>
            </div>
            <p className="mt-2 text-2xl font-bold">{formatCents(totalOpenCents)}</p>
          </div>
          <div className="rounded-2xl bg-white/5 p-4 ring-1 ring-white/10 backdrop-blur-sm">
            <div className="flex items-center gap-2 text-primary">
              <Flame className="size-4" />
              <span className="text-xs text-white/60">Leads quentes</span>
            </div>
            <p className="mt-2 text-2xl font-bold">{hotLeadsCount}</p>
          </div>
        </div>
      </div>

      {!hasChannel && (
        <Card className="border-dashed">
          <CardContent className="pt-6 text-sm text-muted-foreground">
            Nenhum canal de WhatsApp conectado ainda — métricas de atendimento aparecem aqui quando isso
            acontecer.
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard
          icon={KanbanSquare}
          variant="dark"
          label="Leads criados"
          value={String(createdInPeriod)}
          delta={showDelta ? percentChange(createdInPeriod, createdPrevMonth) : null}
          progressPct={100}
        />
        <KpiCard
          icon={TrendingUp}
          variant="yellow"
          label="Ganhos"
          value={String(wonInPeriod.length)}
          delta={showDelta ? percentChange(wonInPeriod.length, wonPrevMonth) : null}
          progressPct={createdInPeriod > 0 ? (wonInPeriod.length / createdInPeriod) * 100 : 0}
        />
        <KpiCard
          icon={TrendingDown}
          variant="dark"
          label="Perdidos"
          value={String(lostInPeriod.length)}
          delta={showDelta ? percentChange(lostInPeriod.length, lostPrevMonth) : null}
          progressPct={createdInPeriod > 0 ? (lostInPeriod.length / createdInPeriod) * 100 : 0}
        />
        <KpiCard
          icon={Percent}
          variant="yellow"
          label="Taxa de conversão"
          value={conversionRate === null ? "—" : `${conversionRate}%`}
          delta={showDelta && conversionRate !== null ? percentChange(conversionRate, conversionPrevMonth ?? 0) : null}
          progressPct={conversionRate ?? 0}
        />
      </div>

      {/* Contatos + Ações rápidas */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Contatos cadastrados</CardDescription>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold">{contacts?.length ?? 0}</p>
          </CardContent>
        </Card>

        <div className="grid grid-cols-2 gap-3 lg:col-span-2">
          {QUICK_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className={cn(
                "flex items-center gap-3 rounded-xl p-4 shadow-xs transition-transform hover:-translate-y-0.5 hover:shadow-md",
                action.className,
              )}
            >
              <action.icon className="size-5 shrink-0" />
              <div className="flex flex-col leading-tight">
                <span className="text-sm font-semibold">{action.label}</span>
                <span className="text-xs opacity-70">{action.sub}</span>
              </div>
            </Link>
          ))}
        </div>
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
              <div key={owner.name} className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm">
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                    {getInitials(owner.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="flex-1 truncate">{owner.name}</span>
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

      {stuckLeads.length > 0 && (
        <Card className="border-primary/30 bg-accent/40">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-accent-foreground" />
                Leads parados
              </CardTitle>
              <Badge className="bg-primary text-primary-foreground">{stuckLeads.length}</Badge>
            </div>
            <CardDescription>
              Sem mudar de etapa há {stageAlertDays} dias ou mais — candidatos a follow-up.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {stuckLeads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between rounded-xl bg-background px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{lead.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {stageNameById.get(lead.stage_id) ?? "—"}
                  </span>
                </div>
                <Badge variant="destructive">{lead.daysInStage}d parado</Badge>
              </div>
            ))}
            <Button asChild variant="outline" size="sm" className="mt-1 self-start">
              <Link href="/funil">Ver no funil</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Leads recentes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {recentLeads.map((lead) => (
              <div key={lead.id} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
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
              <p className="text-sm text-muted-foreground">Nenhum lead ainda — crie o primeiro no Funil.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Motivos de perda</CardTitle>
            <CardDescription>{period === "month" ? "Este mês." : "Todo o histórico."}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {topLostReasons.map(([reason, count]) => (
              <div key={reason} className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm">
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
