import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { fetchLastMessageByConversation } from "@/lib/inbox/last-messages";
import { RealtimeListener } from "@/app/(app)/inbox/realtime-listener";
import { MonitorView, type MonitorConversation } from "./monitor-view";

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function MonitorPage() {
  // Só gestor/admin/owner enxerga o painel de supervisão — vendedor comum
  // continua vendo só o próprio Inbox.
  const membership = await requireRoleOrRedirect("manager");
  const supabase = await createClient();

  const { data: conversations } = await supabase
    .from("conversations")
    .select(
      "id, status, last_inbound_at, last_outbound_at, contacts(name, phone_e164), profiles(full_name, presence_status, last_active_at), teams(name)",
    )
    .eq("org_id", membership.orgId)
    .order("last_inbound_at", { ascending: false, nullsFirst: false });

  const lastMessageByConversation = await fetchLastMessageByConversation(supabase, membership.orgId);

  const items: MonitorConversation[] = (conversations ?? []).map((c) => {
    const contact = one(c.contacts);
    const assignedProfile = one(c.profiles);
    const team = one(c.teams);
    const lastMessage = lastMessageByConversation.get(c.id);

    return {
      id: c.id,
      contactName: contact?.name ?? contact?.phone_e164 ?? "Contato",
      contactPhone: contact?.phone_e164 ?? "",
      status: c.status,
      teamName: team?.name ?? null,
      assignedName: assignedProfile?.full_name ?? null,
      assignedPresenceStatus: assignedProfile?.presence_status ?? null,
      assignedLastActiveAt: assignedProfile?.last_active_at ?? null,
      lastMessagePreview: lastMessage?.preview ?? null,
      lastMessageDirection: lastMessage?.direction ?? null,
      lastActivityAt: lastMessage?.createdAt ?? c.last_inbound_at ?? c.last_outbound_at,
    };
  });

  return (
    <div className="flex h-full flex-col gap-4">
      <RealtimeListener orgId={membership.orgId} />
      <div>
        <h1 className="text-2xl font-bold">Monitor</h1>
        <p className="text-muted-foreground">
          Todas as conversas de {membership.orgName} em tempo real, sem precisar recarregar.
        </p>
      </div>
      <MonitorView conversations={items} />
    </div>
  );
}
