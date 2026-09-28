"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { createTeamSchema, toggleTeamMemberSchema } from "@/lib/validation/teams";

export type TeamActionState = { error?: string } | null;

export async function createTeam(
  _prevState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = createTeamSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: team, error } = await supabase
    .from("teams")
    .insert({ org_id: membership.orgId, name: parsed.data.name })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return { error: "Já existe um setor com esse nome." };
    }
    console.error("[teams] createTeam falhou:", error.code, error.message);
    return { error: "Não foi possível criar o setor." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "team.created",
    resourceType: "teams",
    resourceId: team.id,
    after: { name: parsed.data.name },
  });

  revalidatePath("/configuracoes/equipe");
  return null;
}

export async function deleteTeam(formData: FormData): Promise<void> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch {
    return;
  }

  const teamId = formData.get("teamId");
  if (typeof teamId !== "string") return;

  const supabase = await createClient();
  await supabase.from("teams").delete().eq("id", teamId);

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "team.deleted",
    resourceType: "teams",
    resourceId: teamId,
  });

  revalidatePath("/configuracoes/equipe");
}

/** Alterna um membro dentro/fora de um setor — checkbox na tela de Equipe. */
export async function toggleTeamMember(formData: FormData): Promise<void> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch {
    return;
  }

  const parsed = toggleTeamMemberSchema.safeParse({
    teamId: formData.get("teamId"),
    userId: formData.get("userId"),
    action: formData.get("action"),
  });
  if (!parsed.success) return;

  const supabase = await createClient();

  // Setor e pessoa precisam ser desta organização — a RLS só garante o
  // org_id da linha nova, não que team_id/user_id apontem pra cá. Sem isso,
  // um usuário de fora poderia entrar no rodízio e receber conversas.
  const [{ data: team }, { data: member }] = await Promise.all([
    supabase.from("teams").select("id").eq("id", parsed.data.teamId).eq("org_id", membership.orgId).maybeSingle(),
    supabase
      .from("org_members")
      .select("user_id")
      .eq("org_id", membership.orgId)
      .eq("user_id", parsed.data.userId)
      .not("accepted_at", "is", null)
      .maybeSingle(),
  ]);
  if (!team || !member) return;

  if (parsed.data.action === "add") {
    const { error } = await supabase.from("team_members").insert({
      org_id: membership.orgId,
      team_id: parsed.data.teamId,
      user_id: parsed.data.userId,
    });
    if (error) return;
  } else {
    const { error } = await supabase
      .from("team_members")
      .delete()
      .eq("org_id", membership.orgId)
      .eq("team_id", parsed.data.teamId)
      .eq("user_id", parsed.data.userId);
    if (error) return;
  }

  // Quem está em qual setor decide quem recebe lead/conversa pelo rodízio —
  // mudança relevante o bastante pra ficar no histórico.
  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: parsed.data.action === "add" ? "team.member_added" : "team.member_removed",
    resourceType: "teams",
    resourceId: parsed.data.teamId,
    after: { user_id: parsed.data.userId },
  });

  revalidatePath("/configuracoes/equipe");
}
