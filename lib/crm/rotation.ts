import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Só tenta o rodízio se o setor tiver optado por distribuição automática
 * (organizations.teams.auto_distribution) — setores sem essa flag
 * continuam 100% manuais. Retorna null tanto quando o setor não participa
 * quanto quando ninguém está online agora (fn_next_rotation_member já
 * filtra isso); quem chama decide o que fazer com null (deixar sem dono).
 */
export async function tryAutoAssignFromRotation(
  supabase: SupabaseClient,
  teamId: string,
): Promise<string | null> {
  const { data: team } = await supabase
    .from("teams")
    .select("auto_distribution")
    .eq("id", teamId)
    .maybeSingle();

  if (!team?.auto_distribution) return null;

  const { data: nextMemberId, error } = await supabase.rpc("fn_next_rotation_member", {
    p_team_id: teamId,
  });

  if (error) {
    console.error("[rotation] fn_next_rotation_member falhou:", error.code, error.message);
    return null;
  }

  return nextMemberId ?? null;
}
