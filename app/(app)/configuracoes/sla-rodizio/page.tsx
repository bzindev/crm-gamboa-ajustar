import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ReassignForm } from "./reassign-form";
import { SlaForm } from "./sla-form";

export default async function ConfiguracoesSlaRodizioPage() {
  // Só admin/owner acessa e edita — mesmo padrão de /configuracoes/geral
  // (redireciona pro dashboard, não só esconde o link na aba).
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("sla_minutes, reassign_minutes")
    .eq("id", membership.orgId)
    .single();

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Prazos usados pelo rodízio automático de vendedores. Mudança aqui vale a partir do próximo
        minuto — não precisa reiniciar nada.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Reatribuição automática</CardTitle>
          <CardDescription>
            Se o vendedor responsável não mandar nenhuma mensagem dentro desse prazo depois de
            receber a conversa, ela passa pro próximo vendedor disponível no rodízio — o ciclo se
            repete até alguém responder ou ninguém mais estar disponível.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ReassignForm reassignMinutes={org?.reassign_minutes ?? 5} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Alerta de SLA</CardTitle>
          <CardDescription>
            Tempo sem resposta ao cliente até notificar o vendedor responsável e o gestor — só
            avisa, não muda quem está atribuído.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SlaForm slaMinutes={org?.sla_minutes ?? 15} />
        </CardContent>
      </Card>
    </div>
  );
}
