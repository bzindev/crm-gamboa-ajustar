import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { isWithin24hWindow } from "@/lib/whatsapp/window";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/format/initials";
import { MessageBubble, type MessageItem } from "../message-bubble";
import { MessageForm } from "../message-form";

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const { conversationId } = await params;
  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, status, last_inbound_at, contact_id, contacts(id, name, phone_e164, opted_in)")
    .eq("id", conversationId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!conversation) notFound();

  const contact = one(conversation.contacts);

  const { data: messagesData } = await supabase
    .from("messages")
    .select("id, direction, type, content, status, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  const messages: MessageItem[] = (messagesData ?? []).map((m) => {
    const content = m.content as { body?: string } | null;
    return {
      id: m.id,
      direction: m.direction,
      type: m.type,
      body: content?.body ?? `[${m.type}]`,
      status: m.status,
      createdAt: m.created_at,
    };
  });

  const canSend = isWithin24hWindow(conversation.last_inbound_at);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-9">
            <AvatarFallback className="bg-[#18181b] text-xs font-semibold text-white">
              {getInitials(contact?.name ?? contact?.phone_e164 ?? "?")}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">{contact?.name ?? "Contato sem nome"}</p>
            <p className="text-xs text-muted-foreground">{contact?.phone_e164}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {contact?.opted_in && <Badge variant="outline">opt-in</Badge>}
          {contact && (
            <Link href={`/contatos/${contact.id}`} className="text-xs text-primary hover:underline">
              Ver contato
            </Link>
          )}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
      </div>

      <MessageForm conversationId={conversation.id} disabled={!canSend} />
    </div>
  );
}
