import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GeneralForm } from "./general-form";
import { BusinessHoursForm } from "./business-hours-form";
import { RetentionForm } from "./retention-form";
import { CsatForm } from "./csat-form";
import { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_BUCKET, BACKUP_KEEP } from "@/lib/backup/tables";
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/crm/business-hours";

export default async function ConfiguracoesGeralPage() {
  // Só admin/owner acessa — checado no servidor (lib/auth/require-role.ts),
  // não só escondendo o link na sidebar.
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("name, slug, created_at, business_hours, retention_months, csat_enabled, csat_message")
    .eq("id", membership.orgId)
    .single();

  // Só metadado (nome/tamanho) — o arquivo em si tem dados de todas as
  // organizações do sistema e nunca é oferecido pra download por aqui.
  const { data: backupFiles } = await createAdminClient()
    .storage.from(BACKUP_BUCKET)
    .list("", { limit: 1, sortBy: { column: "name", order: "desc" } });
  const lastBackup = backupFiles?.find((f) => f.name.endsWith(".json.gz")) ?? null;

  const businessHours: BusinessHours = {
    ...DEFAULT_BUSINESS_HOURS,
    ...((org?.business_hours as Partial<BusinessHours>) ?? {}),
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">Dados gerais da organização.</p>

      <Card>
        <CardHeader>
          <CardTitle>Organização</CardTitle>
          <CardDescription>
            Identificador: <span className="font-mono">{org?.slug}</span> · criada em{" "}
            {org?.created_at ? new Date(org.created_at).toLocaleDateString("pt-BR") : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeneralForm orgName={org?.name ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Horário de expediente</CardTitle>
          <CardDescription>Usado pelo rodízio automático de vendedores.</CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessHoursForm hours={businessHours} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pesquisa de satisfação</CardTitle>
          <CardDescription>Nota de 1 a 5 pedida ao cliente no fim do atendimento. O resultado aparece no Dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <CsatForm enabled={org?.csat_enabled ?? false} message={org?.csat_message ?? ""} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Retenção de dados (LGPD)</CardTitle>
          <CardDescription>
            Pedido individual de exclusão: abra o contato e use &quot;Anonimizar&quot;. Aqui é a
            limpeza automática de quem ficou inativo por muito tempo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RetentionForm retentionMonths={org?.retention_months ?? null} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Backup automático</CardTitle>
          <CardDescription>
            Cópia diária de todos os dados (03:00), guardada em área privada do Supabase — os últimos {BACKUP_KEEP} dias.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          {lastBackup ? (
            <p>
              Último backup: <strong>{new Date(lastBackup.created_at ?? lastBackup.name.slice(0, 10)).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</strong>
              {" "}({Math.round(((lastBackup.metadata?.size as number | undefined) ?? 0) / 1024)} KB)
            </p>
          ) : (
            <p className="text-muted-foreground">Nenhum backup ainda — o primeiro roda na próxima execução agendada.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
