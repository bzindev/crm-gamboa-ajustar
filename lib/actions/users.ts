"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { createUserSchema, updateMemberSchema } from "@/lib/validation/users";

export type UserActionState = { error?: string; created?: { email: string }; success?: true } | null;

/**
 * Cadastro direto com senha (alternativa ao convite por link). Só pra
 * e-mail SEM conta ainda: se a pessoa já existe (em qualquer organização),
 * criar/alterar por aqui seria mexer na conta de outra pessoa — nesse caso,
 * o caminho é o convite, que ela mesma aceita.
 */
export async function createUserWithPassword(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = createUserSchema.safeParse({
    fullName: formData.get("fullName"),
    email: formData.get("email"),
    role: formData.get("role"),
    password: formData.get("password"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const admin = createAdminClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
    user_metadata: { full_name: parsed.data.fullName },
  });

  if (createError || !created.user) {
    const message = createError?.message.toLowerCase() ?? "";
    if (message.includes("already") || message.includes("exists") || message.includes("registered")) {
      return { error: "Já existe uma conta com esse e-mail. Use \"Convidar\" — a própria pessoa aceita e entra com a senha dela." };
    }
    if (message.includes("password")) return { error: `Senha não aceita: ${createError?.message}` };
    console.error("[users] createUser falhou:", createError?.status, createError?.message);
    return { error: "Não foi possível criar o usuário." };
  }

  // org_members só tem política de leitura pra usuário comum — a inclusão
  // é feita pelo servidor, com a organização vinda da sessão de quem criou.
  const { error: memberError } = await admin.from("org_members").insert({
    org_id: membership.orgId,
    user_id: created.user.id,
    role: parsed.data.role,
    accepted_at: new Date().toISOString(),
  });
  if (memberError) {
    // Sem a membresia a conta fica solta — desfaz em vez de deixar lixo.
    await admin.auth.admin.deleteUser(created.user.id);
    console.error("[users] incluir membro falhou:", memberError.code, memberError.message);
    return { error: "Não foi possível incluir o usuário na organização." };
  }

  const supabase = await createClient();
  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "member.created_with_password",
    resourceType: "org_members",
    resourceId: created.user.id,
    after: { email: parsed.data.email, role: parsed.data.role },
  });

  revalidatePath("/configuracoes/equipe");
  return { created: { email: parsed.data.email } };
}

const ROLE_RANK = { agent: 1, manager: 2, admin: 3, owner: 4 } as const;

/**
 * Editar pessoa da equipe: nome e, opcionalmente, nova senha (em branco =
 * mantém). Redefinir a senha de alguém é o mesmo que poder entrar na conta
 * dessa pessoa — por isso as travas valem pra qualquer mudança em outra
 * pessoa: nunca o dono, admin só de papel abaixo (outro admin só o dono),
 * e nunca quem também participa de OUTRA organização (nome e senha são da
 * conta, não desta organização — mexer aqui mudaria lá também). A própria
 * pessoa pode editar o próprio nome aqui; a própria senha é em Segurança.
 */
export async function updateMember(
  _prevState: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = updateMemberSchema.safeParse({
    userId: formData.get("userId"),
    fullName: formData.get("fullName"),
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const isSelf = parsed.data.userId === membership.userId;
  if (isSelf && parsed.data.password) {
    return { error: "Pra trocar a sua própria senha, use Segurança (menu do avatar)." };
  }

  const admin = createAdminClient();
  const { data: memberships } = await admin
    .from("org_members")
    .select("org_id, role, accepted_at")
    .eq("user_id", parsed.data.userId);

  const here = (memberships ?? []).find((m) => m.org_id === membership.orgId && m.accepted_at);
  if (!here) return { error: "Essa pessoa não faz parte da organização." };

  if (!isSelf) {
    if (here.role === "owner") return { error: "O dono só pode ser editado por ele mesmo." };
    if (ROLE_RANK[here.role as keyof typeof ROLE_RANK] >= ROLE_RANK[membership.role]) {
      return { error: "Só o dono edita outro administrador." };
    }
    if ((memberships ?? []).some((m) => m.org_id !== membership.orgId)) {
      return { error: "Essa pessoa também participa de outra organização — ela mesma precisa alterar nome e senha." };
    }
  }

  const { data: before } = await admin.from("profiles").select("full_name").eq("id", parsed.data.userId).maybeSingle();

  const { error: nameError } = await admin
    .from("profiles")
    .update({ full_name: parsed.data.fullName })
    .eq("id", parsed.data.userId);
  if (nameError) {
    console.error("[users] atualizar nome falhou:", nameError.code, nameError.message);
    return { error: "Não foi possível salvar o nome." };
  }

  if (parsed.data.password) {
    const { error } = await admin.auth.admin.updateUserById(parsed.data.userId, { password: parsed.data.password });
    if (error) {
      if (error.message.toLowerCase().includes("password")) return { error: `Senha não aceita: ${error.message}` };
      console.error("[users] updateUserById falhou:", error.status, error.message);
      return { error: "Nome salvo, mas não foi possível trocar a senha." };
    }
  }

  const supabase = await createClient();
  // A senha nunca vai pro histórico — só o fato de ter sido trocada.
  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: parsed.data.password ? "member.updated_with_password" : "member.updated",
    resourceType: "profiles",
    resourceId: parsed.data.userId,
    before: { full_name: before?.full_name ?? null },
    after: { full_name: parsed.data.fullName, password_changed: Boolean(parsed.data.password) },
  });

  revalidatePath("/configuracoes/equipe");
  return { success: true };
}
