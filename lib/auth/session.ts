import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { ROLE_RANK, type Role } from "@/lib/auth/roles";

export { ROLE_RANK, type Role };

export type ActiveOrgMembership = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  role: Role;
  userId: string;
};

/**
 * getUser() valida o JWT do cookie contra o Supabase Auth a cada chamada —
 * é uma chamada de rede de verdade, não só leitura de cookie (por isso
 * nunca getSession() aqui). `cache()` do React garante que, mesmo se
 * layout + página + algum componente chamarem isso na mesma renderização,
 * a validação de rede acontece só uma vez por requisição — sem isso, uma
 * página comum chegava a validar o JWT 3-4 vezes seguidas.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * Resolve a organização ativa do usuário logado.
 *
 * O cookie `active_org_id` é só uma dica de UX (qual organização mostrar
 * quando o usuário pertence a mais de uma) — nunca é a fonte de verdade
 * sozinho. Toda vez, esta função confirma contra `org_members` que o
 * usuário de fato pertence à organização do cookie antes de usá-la; se não
 * pertencer (cookie desatualizado, adulterado, ou de outra conta), cai de
 * volta para a primeira organização aceita do usuário.
 *
 * Retorna null quando o usuário está autenticado mas ainda não é membro
 * aceito de nenhuma organização — sinal para redirecionar a /onboarding.
 */
export const getActiveOrgMembership = cache(async (): Promise<ActiveOrgMembership | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data: memberships, error } = await supabase
    .from("org_members")
    .select("role, org_id, organizations(name, slug)")
    .eq("user_id", user.id)
    .not("accepted_at", "is", null);

  if (error || !memberships || memberships.length === 0) {
    return null;
  }

  const cookieStore = await cookies();
  const preferredOrgId = cookieStore.get("active_org_id")?.value;

  const chosen =
    memberships.find((m) => m.org_id === preferredOrgId) ?? memberships[0];

  const org = Array.isArray(chosen.organizations)
    ? chosen.organizations[0]
    : chosen.organizations;

  if (!org) return null;

  return {
    orgId: chosen.org_id,
    orgName: org.name,
    orgSlug: org.slug,
    role: chosen.role as Role,
    userId: user.id,
  };
});

/** Nome de exibição do usuário logado — usado no rodapé da sidebar e no header. */
export const getCurrentProfile = cache(async (): Promise<{ fullName: string | null } | null> => {
  const user = await getUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .single();

  return { fullName: data?.full_name ?? null };
});

export type OrgMembershipSummary = {
  orgId: string;
  orgName: string;
  role: Role;
};

/** Todas as organizações de que o usuário logado é membro aceito — para o seletor da sidebar. */
export const listUserOrganizations = cache(async (): Promise<OrgMembershipSummary[]> => {
  const user = await getUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data: memberships } = await supabase
    .from("org_members")
    .select("role, org_id, organizations(name)")
    .eq("user_id", user.id)
    .not("accepted_at", "is", null);

  if (!memberships) return [];

  return memberships
    .map((m) => {
      const org = Array.isArray(m.organizations) ? m.organizations[0] : m.organizations;
      if (!org) return null;
      return { orgId: m.org_id, orgName: org.name, role: m.role as Role };
    })
    .filter((m): m is OrgMembershipSummary => m !== null);
});
