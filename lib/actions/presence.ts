"use server";

import { createClient } from "@/lib/supabase/server";
import { getUser } from "@/lib/auth/session";

/**
 * Heartbeat chamado pelo cliente (PresenceHeartbeat) a cada ~60s enquanto a
 * aba está aberta, e imediatamente quando o usuário passa de ausente para
 * ativo de novo. "offline" nunca é gravado aqui de propósito — ninguém
 * consegue avisar o servidor no momento exato em que fecha a aba; o status
 * efetivo "offline" é sempre derivado (ver lib/presence/status.ts) a partir
 * de quanto tempo faz que o último heartbeat chegou.
 */
export async function setPresence(status: "online" | "away"): Promise<void> {
  const user = await getUser();
  if (!user) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ presence_status: status, last_active_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error) {
    console.error("[presence] setPresence falhou:", error.code, error.message);
  }
}
