import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { messagePreview } from "@/lib/inbox/message-preview";

export type LastMessageInfo = {
  preview: string;
  createdAt: string;
  direction: "inbound" | "outbound";
};

// Recorte pragmático para a fase sem tráfego real ainda: uma vez que o
// número estiver em uso de verdade, isso vira paginação por conversa em
// vez de "últimas 200 mensagens de toda a organização". Usado tanto pela
// lista do Inbox quanto pelo painel de Monitoramento — mesma regra de
// "qual foi a última mensagem de cada conversa" nos dois lugares.
export async function fetchLastMessageByConversation(
  supabase: SupabaseClient,
  orgId: string,
): Promise<Map<string, LastMessageInfo>> {
  const { data: recentMessages } = await supabase
    .from("messages")
    .select("conversation_id, content, type, direction, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  const lastMessageByConversation = new Map<string, LastMessageInfo>();
  for (const message of recentMessages ?? []) {
    if (lastMessageByConversation.has(message.conversation_id)) continue;
    lastMessageByConversation.set(message.conversation_id, {
      preview: messagePreview(message.type, message.content),
      createdAt: message.created_at,
      direction: message.direction,
    });
  }

  return lastMessageByConversation;
}
