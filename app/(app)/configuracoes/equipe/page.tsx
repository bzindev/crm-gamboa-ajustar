import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/auth/role-labels";
import type { Role } from "@/lib/auth/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { InviteForm } from "./invite-form";

type MemberRow = {
  id: string;
  role: Role;
  accepted_at: string | null;
  profiles: { full_name: string | null } | { full_name: string | null }[] | null;
};

type InviteRow = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
};

export default async function EquipePage() {
  // Só admin/owner acessa esta tela — checado no servidor, não só
  // escondendo o link de navegação para os outros papéis.
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  // A RLS de org_members só garante "organização sua" — como o usuário
  // pode pertencer a mais de uma, o filtro pela organização ATIVA é
  // responsabilidade explícita da query, não da RLS.
  const [{ data: members }, { data: invites }] = await Promise.all([
    supabase
      .from("org_members")
      .select("id, role, accepted_at, profiles(full_name)")
      .eq("org_id", membership.orgId)
      .order("accepted_at", { ascending: true }),
    supabase
      .from("org_invites")
      .select("id, email, role, expires_at")
      .eq("org_id", membership.orgId)
      .is("accepted_at", null)
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Equipe</h1>
        <p className="text-muted-foreground">
          Membros e convites pendentes de {membership.orgName}.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Convidar</CardTitle>
          <CardDescription>
            Gera um link para enviar por onde preferir — sem depender de envio
            automático de e-mail por enquanto.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <InviteForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(members as MemberRow[] | null)?.map((member) => {
            const profile = Array.isArray(member.profiles)
              ? member.profiles[0]
              : member.profiles;
            return (
              <div
                key={member.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{profile?.full_name ?? "(sem nome)"}</span>
                <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {invites && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Convites pendentes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(invites as InviteRow[]).map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
              >
                <span>{invite.email}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{ROLE_LABELS[invite.role]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    expira em {new Date(invite.expires_at).toLocaleDateString("pt-BR")}
                  </span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
