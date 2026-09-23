import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import type { ConversationSummary } from "./conversation-list";
import { InboxShell } from "./inbox-shell";
import { RealtimeListener } from "./realtime-listener";
import { fetchLastMessageByConversation } from "@/lib/inbox/last-messages";

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

  // Sem "order by" aqui de propósito — a ordem final depende de qual foi a
  // mensagem mais recente em QUALQUER direção (cliente ou vendedor), que só
  // dá pra saber depois de já ter cruzado com fetchLastMessageByConversation
  // abaixo. Ordenar só por last_inbound_at (como antes) deixava a lista
  // "presa" quando a última coisa que aconteceu foi o vendedor respondendo.
  const { data: conversations } = await supabase
    .from("conversations")
    .select(
      "id, status, last_inbound_at, last_outbound_at, assigned_to, contacts(name, phone_e164), profiles(full_name)",
    )
    .eq("org_id", membership.orgId);

  const lastMessageByConversation = await fetchLastMessageByConversation(supabase, membership.orgId);

  const items: ConversationSummary[] = (conversations ?? [])
    .map((c) => {
      const contact = Array.isArray(c.contacts) ? c.contacts[0] : c.contacts;
      const assignedProfile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
      const lastMessage = lastMessageByConversation.get(c.id);
      return {
        id: c.id,
        contactName: contact?.name ?? contact?.phone_e164 ?? "Contato",
        contactPhone: contact?.phone_e164 ?? "",
        status: c.status,
        assignedToId: c.assigned_to,
        assignedToMe: c.assigned_to === membership.userId,
        assignedToName: c.assigned_to ? (assignedProfile?.full_name ?? "outro vendedor") : null,
        lastMessagePreview: lastMessage?.preview ?? null,
        lastActivityAt: lastMessage?.createdAt ?? c.last_inbound_at ?? c.last_outbound_at,
      };
    })
    .sort((a, b) => {
      const aTime = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : 0;
      const bTime = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : 0;
      return bTime - aTime;
    });

  return (
    <div className="flex h-full flex-col">
      <RealtimeListener orgId={membership.orgId} />
      <InboxShell conversations={items}>{children}</InboxShell>
    </div>
  );
}
