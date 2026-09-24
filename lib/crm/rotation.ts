import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isWithinBusinessHours, DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/crm/business-hours";

/**
 * Só tenta o rodízio se o setor tiver optado por distribuição automática
 * (organizations.teams.auto_distribution) — setores sem essa flag
 * continuam 100% manuais. Fora do horário de expediente também não
 * distribui (fica sem dono pra alguém pegar manualmente quando abrir, em
 * vez de "acordar" um vendedor de madrugada). Retorna null em qualquer um
 * desses casos, ou quando ninguém está online agora
 * (fn_next_rotation_member já filtra isso) — quem chama decide o que
 * fazer com null (deixar sem dono).
 */
export async function tryAutoAssignFromRotation(
  supabase: SupabaseClient,
  orgId: string,
  teamId: string,
): Promise<string | null> {
  const [{ data: team }, { data: org }] = await Promise.all([
    supabase.from("teams").select("auto_distribution").eq("id", teamId).maybeSingle(),
    supabase.from("organizations").select("business_hours").eq("id", orgId).maybeSingle(),
  ]);

  if (!team?.auto_distribution) return null;

  const businessHours: BusinessHours = {
    ...DEFAULT_BUSINESS_HOURS,
    ...((org?.business_hours as Partial<BusinessHours>) ?? {}),
  };
  if (!isWithinBusinessHours(businessHours)) return null;

  const { data: nextMemberId, error } = await supabase.rpc("fn_next_rotation_member", {
    p_team_id: teamId,
  });

  if (error) {
    console.error("[rotation] fn_next_rotation_member falhou:", error.code, error.message);
    return null;
  }

  return nextMemberId ?? null;
}
