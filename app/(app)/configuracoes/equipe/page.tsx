import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { ROLE_LABELS } from "@/lib/auth/role-labels";
import { getInitials } from "@/lib/format/initials";
import type { Role } from "@/lib/auth/session";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PresenceDot } from "@/components/presence/presence-dot";
import { resolvePresenceStatus, PRESENCE_LABELS } from "@/lib/presence/status";
import { InviteForm } from "./invite-form";
import { CreateUserForm } from "./create-user-form";
import { EditMemberDialog } from "./edit-member-dialog";
import { createAdminClient } from "@/lib/supabase/admin";
import { TeamsSection } from "./teams-section";
import { RemoveMemberButton } from "./remove-member-button";
import { CancelInviteButton } from "./cancel-invite-button";
import { PresenceListener } from "@/components/presence/presence-listener";

type ProfileRow = {
  full_name: string | null;
  presence_status: string | null;
  last_active_at: string | null;
};

type MemberRow = {
  id: string;
  user_id: string;
  role: Role;
  accepted_at: string | null;
  profiles: ProfileRow | ProfileRow[] | null;
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
  const [{ data: members }, { data: invites }, { data: teamsData }, { data: teamMembers }] =
    await Promise.all([
      supabase
        .from("org_members")
        .select("id, user_id, role, accepted_at, profiles(full_name, presence_status, last_active_at)")
        .eq("org_id", membership.orgId)
        .not("accepted_at", "is", null)
        .order("accepted_at", { ascending: true }),
      supabase
        .from("org_invites")
        .select("id, email, role, expires_at")
        .eq("org_id", membership.orgId)
        .is("accepted_at", null)
        .order("created_at", { ascending: false }),
      supabase.from("teams").select("id, name").eq("org_id", membership.orgId).order("name"),
      supabase.from("team_members").select("team_id, user_id").eq("org_id", membership.orgId),
    ]);

  const memberList = (members as MemberRow[] | null) ?? [];

  // Espelha as regras de fn_remove_org_member (migration 0022) só pra
  // decidir se o botão aparece — quem decide de verdade é o banco.
  const canRemove = (member: MemberRow) =>
    member.user_id !== membership.userId &&
    member.role !== "owner" &&
    (member.role !== "admin" || membership.role === "owner");
  // Mesma régua do servidor (lib/actions/users.ts) pra mostrar "Editar":
  // a própria pessoa (só o nome) ou alguém de papel abaixo.
  const canEdit = (member: MemberRow) => member.user_id === membership.userId || canRemove(member);

  // E-mail é o login — mora no Auth, não em profiles. Página só de admin,
  // e só dos membros desta organização.
  const admin = createAdminClient();
  const emails = new Map(
    await Promise.all(
      memberList.map(async (m) => {
        const { data } = await admin.auth.admin.getUserById(m.user_id);
        return [m.user_id, data.user?.email ?? null] as const;
      }),
    ),
  );

  const memberOptions = memberList.map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { userId: m.user_id, name: profile?.full_name ?? "(sem nome)" };
  });

  const teams = (teamsData ?? []).map((team) => ({
    id: team.id,
    name: team.name,
    memberIds: (teamMembers ?? []).filter((tm) => tm.team_id === team.id).map((tm) => tm.user_id),
  }));

  return (
    <div className="flex flex-col gap-6">
      <PresenceListener />
      <p className="text-sm text-muted-foreground">
        Membros, convites e setores de {membership.orgName}.
      </p>

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
          <CardTitle>Cadastrar usuário</CardTitle>
          <CardDescription>
            Cria o acesso direto com e-mail e senha — sem precisar de link de convite. Pra quem já tem
            conta no sistema, use Convidar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateUserForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Membros</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {memberList.map((member) => {
            const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
            const name = profile?.full_name ?? "(sem nome)";
            const status = resolvePresenceStatus(profile?.presence_status, profile?.last_active_at);
            return (
              <div
                key={member.id}
                className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm"
              >
                <div className="relative shrink-0">
                  <Avatar className="size-8">
                    <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                      {getInitials(name)}
                    </AvatarFallback>
                  </Avatar>
                  <PresenceDot
                    presenceStatus={profile?.presence_status}
                    lastActiveAt={profile?.last_active_at}
                    className="absolute -right-0.5 -bottom-0.5"
                  />
                </div>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{name}</span>
                  {emails.get(member.user_id) && (
                    <span className="truncate text-xs text-muted-foreground">{emails.get(member.user_id)}</span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">{PRESENCE_LABELS[status]}</span>
                <Badge variant="secondary">{ROLE_LABELS[member.role]}</Badge>
                {canEdit(member) ? (
                  <EditMemberDialog userId={member.user_id} name={name} isSelf={member.user_id === membership.userId} />
                ) : (
                  <span className="w-[74px]" />
                )}
                {canRemove(member) ? (
                  <RemoveMemberButton userId={member.user_id} name={name} />
                ) : (
                  <span className="size-8" />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <TeamsSection teams={teams} members={memberOptions} />

      {invites && invites.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Convites pendentes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {(invites as InviteRow[]).map((invite) => (
              <div
                key={invite.id}
                className="flex items-center justify-between rounded-xl border px-3 py-2 text-sm"
              >
                <span>{invite.email}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{ROLE_LABELS[invite.role]}</Badge>
                  <span className="text-xs text-muted-foreground">
                    expira em {new Date(invite.expires_at).toLocaleDateString("pt-BR")}
                  </span>
                  <CancelInviteButton inviteId={invite.id} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
