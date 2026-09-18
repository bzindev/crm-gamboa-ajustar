import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StageAlertForm } from "./stage-alert-form";

const EVENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pendente",
  processing: "Processando",
  done: "Concluído",
  failed: "Falhou",
  dead: "Descartado",
};

const EVENT_STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  pending: "secondary",
  processing: "outline",
  done: "default",
  failed: "destructive",
  dead: "destructive",
};

type StageChangedPayload = {
  lead_id?: string;
  from_stage_id?: string;
  to_stage_id?: string;
};

export default async function AutomacoesPage() {
  // Só admin/owner acessa — mesma checagem no servidor usada em
  // /configuracoes/equipe e /configuracoes/geral.
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  const [{ data: org }, { data: events }, { data: stages }, { data: leads }] = await Promise.all([
    supabase.from("organizations").select("stage_alert_days").eq("id", membership.orgId).single(),
    supabase
      .from("event_log")
      .select("id, type, payload, status, created_at, processed_at")
      .eq("org_id", membership.orgId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("pipeline_stages").select("id, name").eq("org_id", membership.orgId),
    supabase.from("leads").select("id, title").eq("org_id", membership.orgId),
  ]);

  const stageNameById = new Map((stages ?? []).map((s) => [s.id, s.name]));
  const leadTitleById = new Map((leads ?? []).map((l) => [l.id, l.title]));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Automações</h1>
        <p className="text-muted-foreground">
          Regras automáticas de {membership.orgName} e o histórico de eventos que elas geraram.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alerta de lead parado</CardTitle>
          <CardDescription>
            Quando um lead em aberto passa esse número de dias sem mudar de etapa, ele aparece
            como &quot;parado&quot; no Dashboard e no Funil.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StageAlertForm stageAlertDays={org?.stage_alert_days ?? 3} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Fila de eventos</CardTitle>
          <CardDescription>
            Cada mudança de etapa gera uma linha aqui. Ainda não existe um worker consumindo essa
            fila (depende do WhatsApp/Meta ser conectado) — por isso todo evento fica
            &quot;pendente&quot; por enquanto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Lead</TableHead>
                <TableHead>De → Para</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(events ?? []).map((event) => {
                const payload = event.payload as StageChangedPayload;
                const leadTitle = payload.lead_id
                  ? (leadTitleById.get(payload.lead_id) ?? "(lead removido)")
                  : "—";
                const fromStage = payload.from_stage_id
                  ? (stageNameById.get(payload.from_stage_id) ?? "—")
                  : "—";
                const toStage = payload.to_stage_id
                  ? (stageNameById.get(payload.to_stage_id) ?? "—")
                  : "—";

                return (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(event.created_at).toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-sm">{event.type}</TableCell>
                    <TableCell className="text-sm">{leadTitle}</TableCell>
                    <TableCell className="text-sm">
                      {fromStage} → {toStage}
                    </TableCell>
                    <TableCell>
                      <Badge variant={EVENT_STATUS_VARIANT[event.status] ?? "secondary"}>
                        {EVENT_STATUS_LABELS[event.status] ?? event.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!events || events.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Nenhum evento registrado ainda.
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
