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
