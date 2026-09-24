"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";

export async function markNotificationRead(notificationId: string) {
  const membership = await getActiveOrgMembership();
  if (!membership) return;

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .is("read_at", null);

  revalidatePath("/", "layout");
}

export async function markAllNotificationsRead() {
  const membership = await getActiveOrgMembership();
  if (!membership) return;

  const supabase = await createClient();
  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", membership.userId)
    .is("read_at", null);

  revalidatePath("/", "layout");
}

/**
 * Conta conversas com mensagem do cliente ainda não vista pelo vendedor
 * logado — usada no título da aba ("(3) CRM"), não no sino. Comparar
 * last_read_at com last_inbound_at não dá pra empurrar pro filtro do
 * supabase-js (é coluna com coluna, não coluna com valor), mas a lista de
 * conversas de UM vendedor é sempre pequena, então filtrar aqui mesmo,
 * depois de buscar, é suficiente — não precisa de função no banco.
 */
export async function getUnreadConversationCount(): Promise<number> {
  const membership = await getActiveOrgMembership();
  if (!membership) return 0;

  const supabase = await createClient();
  const { data } = await supabase
    .from("conversations")
    .select("last_inbound_at, last_read_at")
    .eq("org_id", membership.orgId)
    .eq("assigned_to", membership.userId)
    .neq("status", "closed")
    .not("last_inbound_at", "is", null);

  if (!data) return 0;

  return data.filter(
    (c) => !c.last_read_at || new Date(c.last_read_at) < new Date(c.last_inbound_at!),
  ).length;
}
