import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RankingMessage } from "@/lib/reports/vendor-ranking";

const PAGE_SIZE = 1000;
const MAX_ROWS = 20000;

/**
 * Pagina de 1000 em 1000 porque o Supabase corta qualquer SELECT em 1000
 * linhas por padrão, sem avisar — sem isso, o ranking do período "Total"
 * ficaria silenciosamente incompleto numa base com bastante conversa.
 */
export async function fetchMessagesForRanking(
  supabase: SupabaseClient,
  orgId: string,
  fromIso: string | null,
): Promise<RankingMessage[]> {
  const all: RankingMessage[] = [];

  for (let offset = 0; offset < MAX_ROWS; offset += PAGE_SIZE) {
    let query = supabase
      .from("messages")
      .select("conversation_id, direction, created_at, sent_by")
      .eq("org_id", orgId);
    if (fromIso) query = query.gte("created_at", fromIso);

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("[vendor-ranking] falha ao buscar mensagens:", error.code, error.message);
      break;
    }
    if (!data) break;

    all.push(...(data as RankingMessage[]));
    if (data.length < PAGE_SIZE) break;
  }

  return all;
}
