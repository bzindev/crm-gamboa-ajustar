import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/auth/role-labels";
import type { Role } from "@/lib/auth/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AcceptInviteForm } from "./accept-invite-form";

type InvitePreview = {
  org_name: string;
  email: string;
  role: Role;
  is_expired: boolean;
  is_accepted: boolean;
};

export default async function ConvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = await createClient();

  const { data } = await supabase
    .rpc("fn_get_invite_preview", { p_token: token })
    .single<InvitePreview>();

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Convite não encontrado</CardTitle>
          <CardDescription>
            Verifique se o link foi copiado corretamente.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (data.is_accepted) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Convite já utilizado</CardTitle>
          <CardDescription>
            Este convite para {data.org_name} já foi aceito. Faça login normalmente.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild>
            <Link href="/login">Ir para o login</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (data.is_expired) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Convite expirado</CardTitle>
          <CardDescription>
            Peça a um administrador de {data.org_name} para gerar um novo link.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const user = await getUser();
  const inviteUrl = `/convite/${token}`;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Convite para {data.org_name}</CardTitle>
        <CardDescription>
          {data.email} foi convidado(a) como {ROLE_LABELS[data.role]}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {user ? (
          <AcceptInviteForm token={token} />
        ) : (
          <div className="flex flex-col gap-3">
            <Button asChild>
              <Link
                href={`/cadastro?redirectTo=${encodeURIComponent(inviteUrl)}&email=${encodeURIComponent(data.email)}`}
              >
                Criar conta e aceitar
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href={`/login?redirectTo=${encodeURIComponent(inviteUrl)}`}>
                Já tenho conta
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
