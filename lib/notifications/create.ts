import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Fire-and-forget, mesmo padrão de lib/audit/log.ts: se a notificação
 * falhar, a mutação principal (lead atribuído, mensagem recebida) não é
 * desfeita por causa disso.
 */
export async function createNotification(
  supabase: SupabaseClient,
  params: {
    orgId: string;
    userId: string;
    type: string;
    title: string;
    body?: string | null;
    link?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    org_id: params.orgId,
    user_id: params.userId,
    type: params.type,
    title: params.title,
    body: params.body ?? null,
    link: params.link ?? null,
  });

  if (error) {
    console.error("[notifications] falha ao criar:", error.code, error.message);
  }
}
