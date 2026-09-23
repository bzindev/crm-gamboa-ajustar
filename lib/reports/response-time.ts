import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

// Tempo entre a mensagem do cliente e a primeira resposta do vendedor
// depois dela, por conversa — não existe coluna pronta pra isso, calcula
// varrendo as mensagens em ordem. Ignora janelas onde o cliente mandou
// mais de uma mensagem seguida (só conta da primeira até a resposta).
export async function getAverageResponseMinutes(
  supabase: SupabaseClient,
  orgId: string,
  from: string,
  to: string,
): Promise<number | null> {
  const { data: messages } = await supabase
    .from("messages")
    .select("conversation_id, direction, created_at")
    .eq("org_id", orgId)
    .gte("created_at", `${from}T00:00:00.000Z`)
    .lte("created_at", `${to}T23:59:59.999Z`)
    .order("conversation_id", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(2000);

  if (!messages || messages.length === 0) return null;

  const waitingSince = new Map<string, string>();
  const samples: number[] = [];

  for (const message of messages) {
    if (message.direction === "inbound") {
      if (!waitingSince.has(message.conversation_id)) {
        waitingSince.set(message.conversation_id, message.created_at);
      }
    } else if (waitingSince.has(message.conversation_id)) {
      const since = waitingSince.get(message.conversation_id)!;
      const minutes = (new Date(message.created_at).getTime() - new Date(since).getTime()) / 60000;
      if (minutes >= 0) samples.push(minutes);
      waitingSince.delete(message.conversation_id);
    }
  }

  if (samples.length === 0) return null;
  return samples.reduce((sum, m) => sum + m, 0) / samples.length;
}

export function formatResponseMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest > 0 ? `${hours}h ${rest}min` : `${hours}h`;
}
