import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { ConversationList, type ConversationSummary } from "./conversation-list";
import { RealtimeListener } from "./realtime-listener";

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("id, status")
    .eq("org_id", membership.orgId)
    .eq("status", "connected")
    .maybeSingle();

  if (!channel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold">Nenhum número conectado</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Conecte o número oficial do WhatsApp (Meta Cloud API) para começar a receber e responder
          conversas por aqui.
        </p>
        <Button asChild>
          <Link href="/configuracoes/whatsapp">Conectar WhatsApp</Link>
        </Button>
      </div>
    );
  }

  const { data: conversations } = await supabase
    .from("conversations")
    .select(
      "id, status, last_inbound_at, last_outbound_at, assigned_to, contacts(name, phone_e164), profiles(full_name)",
    )
    .eq("org_id", membership.orgId)
    .order("last_inbound_at", { ascending: false, nullsFirst: false });

  // Recorte pragmático para a fase sem tráfego real ainda: uma vez que o
  // número estiver em uso de verdade, isso vira paginação por conversa em
  // vez de "últimas 200 mensagens de toda a organização".
  const { data: recentMessages } = await supabase
    .from("messages")
    .select("conversation_id, content, type, created_at")
    .eq("org_id", membership.orgId)
    .order("created_at", { ascending: false })
    .limit(200);

  const lastMessageByConversation = new Map<string, { preview: string; createdAt: string }>();
  for (const message of recentMessages ?? []) {
    if (lastMessageByConversation.has(message.conversation_id)) continue;
    const content = message.content as { body?: string } | null;
    lastMessageByConversation.set(message.conversation_id, {
      preview: content?.body ?? `[${message.type}]`,
      createdAt: message.created_at,
    });
  }

  const items: ConversationSummary[] = (conversations ?? []).map((c) => {
    const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
    const assignedProfile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    const lastMessage = lastMessageByConversation.get(c.id);
    return {
      id: c.id,
      contactName: contact?.name ?? contact?.phone_e164 ?? "Contato",
      contactPhone: contact?.phone_e164 ?? "",
      status: c.status,
      assignedToMe: c.assigned_to === membership.userId,
      assignedToName: c.assigned_to ? (assignedProfile?.full_name ?? "outro vendedor") : null,
      lastMessagePreview: lastMessage?.preview ?? null,
      lastActivityAt: lastMessage?.createdAt ?? c.last_inbound_at ?? c.last_outbound_at,
    };
  });

  return (
    <div className="flex h-full gap-4">
      <RealtimeListener orgId={membership.orgId} />
      <ConversationList conversations={items} />
      <div className="flex-1 overflow-hidden rounded-lg border bg-background">{children}</div>
    </div>
  );
}
