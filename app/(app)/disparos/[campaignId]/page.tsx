import { notFound } from "next/navigation";
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

const CAMPAIGN_STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  sending: "Enviando",
  done: "Concluída",
  failed: "Falhou",
};

const RECIPIENT_STATUS_LABELS: Record<string, string> = {
  pending: "Na fila",
  sent: "Enviada",
  failed: "Falhou",
  skipped_no_consent: "Sem consentimento",
};

const RECIPIENT_STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  pending: "secondary",
  sent: "default",
  failed: "destructive",
  skipped_no_consent: "outline",
};

export default async function CampanhaDetailPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const membership = await requireRoleOrRedirect("manager");
  const { campaignId } = await params;
  const supabase = await createClient();

  const { data: campaign } = await supabase
    .from("bulk_campaigns")
    .select("id, name, status, total_recipients, sent_count, failed_count, created_at, message_templates(name)")
    .eq("id", campaignId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!campaign) notFound();

  const template = Array.isArray(campaign.message_templates)
    ? campaign.message_templates[0]
    : campaign.message_templates;

  const { data: recipients } = await supabase
    .from("bulk_campaign_recipients")
    .select("id, status, error_message, sent_at, contacts(name, phone_e164)")
    .eq("campaign_id", campaignId)
    .order("status");

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>{campaign.name}</CardTitle>
            <Badge>{CAMPAIGN_STATUS_LABELS[campaign.status] ?? campaign.status}</Badge>
          </div>
          <CardDescription>
            Template: {template?.name ?? "—"} · criada em{" "}
            {new Date(campaign.created_at).toLocaleString("pt-BR")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-6 text-sm">
          <span>
            <strong>{campaign.total_recipients}</strong> destinatários
          </span>
          <span className="text-positive">
            <strong>{campaign.sent_count}</strong> enviadas
          </span>
          {campaign.failed_count > 0 && (
            <span className="text-destructive">
              <strong>{campaign.failed_count}</strong> falharam
            </span>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Destinatários</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contato</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Detalhe</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(recipients ?? []).map((r) => {
                const contact = Array.isArray(r.contacts) ? r.contacts[0] : r.contacts;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-medium">{contact?.name ?? "—"}</p>
                      <p className="font-mono text-xs text-muted-foreground">{contact?.phone_e164}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={RECIPIENT_STATUS_VARIANT[r.status] ?? "outline"}>
                        {RECIPIENT_STATUS_LABELS[r.status] ?? r.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {r.status === "failed" ? (r.error_message ?? "Erro desconhecido") : ""}
                      {r.status === "sent" && r.sent_at && new Date(r.sent_at).toLocaleString("pt-BR")}
                    </TableCell>
                  </TableRow>
                );
              })}
              {(!recipients || recipients.length === 0) && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    Nenhum destinatário.
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
