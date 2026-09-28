import { redirect } from "next/navigation";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MfaSettings } from "./mfa-settings";

// Configuração pessoal (de cada usuário), não da organização — por isso
// fica fora de /configuracoes e qualquer papel acessa.
export default async function SegurancaPage() {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Segurança da conta</h1>
        <p className="text-muted-foreground">Configurações pessoais de acesso.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Verificação em duas etapas (2FA)</CardTitle>
          <CardDescription>Um código do celular, além da senha, a cada login.</CardDescription>
        </CardHeader>
        <CardContent>
          <MfaSettings />
        </CardContent>
      </Card>
    </div>
  );
}
