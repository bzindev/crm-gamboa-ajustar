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
import { ChannelForm } from "./channel-form";
import { DisconnectButton } from "./disconnect-button";

export default async function WhatsAppSettingsPage() {
  // Só admin/owner acessa — mesma checagem do resto de /configuracoes.
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("id, waba_id, phone_number_id, display_phone_number, status, last_health_check_at")
    .eq("org_id", membership.orgId)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const webhookUrl = `${appUrl}/api/webhooks/whatsapp`;
  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">WhatsApp</h1>
        <p className="text-muted-foreground">
          Conecte o número oficial (Meta Cloud API) de {membership.orgName}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Canal
            {channel && (
              <Badge variant={channel.status === "connected" ? "default" : "secondary"}>
                {channel.status === "connected" ? "conectado" : "desconectado"}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            {channel
              ? `${channel.display_phone_number ?? channel.phone_number_id} · WABA ${channel.waba_id}`
              : "Nenhum número conectado ainda."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {channel && channel.status === "connected" ? (
            <DisconnectButton channelId={channel.id} />
          ) : (
            <ChannelForm />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Configuração do webhook no Meta for Developers</CardTitle>
          <CardDescription>
            Cole estes dois valores na tela de configuração do webhook do seu app, em WhatsApp →
            Configuration.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm">
          <div>
            <p className="text-xs font-medium text-muted-foreground">Callback URL</p>
            <p className="font-mono">{webhookUrl}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Verify token</p>
            <p className="font-mono">
              {verifyToken ?? "WHATSAPP_WEBHOOK_VERIFY_TOKEN não configurado no servidor."}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium text-muted-foreground">Campo de assinatura</p>
            <p>Marque &quot;messages&quot; na lista de campos do webhook.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
