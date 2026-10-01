import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { isWithin24hWindow } from "@/lib/whatsapp/window";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/format/initials";
import { MessageBubble, type MessageItem } from "../message-bubble";
import { MessageForm } from "../message-form";
import { StatusSelect } from "../status-select";
import { ActiveConversationTracker } from "../active-conversation-tracker";
import { TransferDialog } from "../transfer-dialog";
import { ClaimButton } from "../claim-button";
import { ConversationLabels } from "../conversation-labels";
import type { Temperature } from "@/lib/crm/temperature";

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
    .select(
      "id, status, temperature, last_inbound_at, contact_id, assigned_to, contacts(id, name, phone_e164, opted_in), profiles(full_name)",
    )
    .eq("id", conversationId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!conversation) notFound();

  // Vendedor comum vê só as próprias conversas e a fila (mesma regra da
  // lista, que está em fn_search_conversations) — inclusive abrindo pelo link.
  if (membership.role === "agent" && conversation.assigned_to && conversation.assigned_to !== membership.userId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium">Essa conversa está com outro vendedor.</p>
        <p className="max-w-sm text-xs text-muted-foreground">
          Peça a um gestor para transferir se precisar assumir o atendimento.
        </p>
      </div>
    );
  }

  const contact = one(conversation.contacts);
  const assignedProfile = one(conversation.profiles);

  const [{ data: orgTags }, { data: conversationTags }] = await Promise.all([
    supabase.from("tags").select("id, name, color").eq("org_id", membership.orgId).order("name"),
    supabase.from("conversation_tags").select("tag_id").eq("org_id", membership.orgId).eq("conversation_id", conversationId),
  ]);

  // Só aprovados: rascunho/pendente/recusado a Meta não entrega.
  const { data: approvedTemplates } = await supabase
    .from("message_templates")
    .select("id, name, category, body_text, variable_count")
    .eq("org_id", membership.orgId)
    .eq("status", "approved")
    .order("name");

  const { data: quickReplies } = await supabase
    .from("quick_replies")
    .select("id, title, body")
    .eq("org_id", membership.orgId)
    .order("title");

  const { data: members } = await supabase
    .from("org_members")
    .select("user_id, profiles(full_name)")
    .eq("org_id", membership.orgId)
    .not("accepted_at", "is", null);

  const transferTargets = (members ?? [])
    .filter((m) => m.user_id !== conversation.assigned_to)
    .map((m) => ({ id: m.user_id, name: one(m.profiles)?.full_name ?? "Sem nome" }));

  const { data: messagesData } = await supabase
    .from("messages")
    .select("id, direction, type, content, status, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  type StoredContent = {
    body?: string | null;
    media?: { path?: string; mime?: string; filename?: string; size?: number; unavailable?: boolean } | null;
    location?: { latitude: number; longitude: number; name?: string | null; address?: string | null } | null;
  } | null;

  // Link temporário (1h) pra ver cada arquivo — o bucket é privado. Só
  // assina caminho desta organização E desta conversa (defesa extra: o
  // caminho está no banco, mas não custa não confiar nele cegamente).
  const mediaPrefix = `${membership.orgId}/${conversation.id}/`;
  const mediaPaths = (messagesData ?? [])
    .map((m) => (m.content as StoredContent)?.media?.path)
    .filter((path): path is string => Boolean(path?.startsWith(mediaPrefix)));
  const signedUrlByPath = new Map<string, string>();
  if (mediaPaths.length) {
    const { data: signed } = await createAdminClient().storage.from("chat-media").createSignedUrls(mediaPaths, 3600);
    for (const item of signed ?? []) if (item.path && item.signedUrl) signedUrlByPath.set(item.path, item.signedUrl);
  }

  const messages: MessageItem[] = (messagesData ?? []).map((m) => {
    const content = m.content as StoredContent;
    const media = content?.media;
    return {
      id: m.id,
      direction: m.direction,
      type: m.type,
      body: content?.body ?? (media || content?.location ? "" : `[${m.type}]`),
      status: m.status,
      createdAt: m.created_at,
      media: media
        ? {
            url: media.path ? (signedUrlByPath.get(media.path) ?? null) : null,
            mime: media.mime ?? "",
            filename: media.filename ?? "arquivo",
            size: media.size ?? null,
          }
        : null,
      location: content?.location ?? null,
    };
  });

  const isMine = conversation.assigned_to === membership.userId;
  const readOnly = Boolean(conversation.assigned_to) && !isMine;
  const outsideWindow = !isWithin24hWindow(conversation.last_inbound_at);
  // Só quem realmente consegue assumir vê o botão no rodapé: qualquer um
  // pode pegar uma conversa livre, mas tomar de outro vendedor é exclusivo
  // de gestor/admin (mesma regra de lib/actions/conversations.ts).
  const canClaim = !conversation.assigned_to || membership.role !== "agent";
  // Mesma régua de lib/actions/conversations.ts: vendedor repassa só a
  // própria conversa; gestor/admin repassa qualquer uma — inclusive uma
  // ainda sem dono, o que na prática é atribuir direto a alguém.
  const canTransfer = isMine || membership.role !== "agent";

  return (
    <div className="flex h-full flex-col">
      <ActiveConversationTracker conversationId={conversation.id} />
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Avatar className="size-9">
            <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
              {getInitials(contact?.name ?? contact?.phone_e164 ?? "?")}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="text-sm font-medium">{contact?.name ?? "Contato sem nome"}</p>
            <p className="text-xs text-muted-foreground">{contact?.phone_e164}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {contact?.opted_in && <Badge variant="outline">opt-in</Badge>}
          {contact && (
            <Link href={`/contatos/${contact.id}`} className="text-xs text-primary hover:underline">
              Ver contato
            </Link>
          )}
          {isMine ? (
            <Badge variant="secondary">Atribuída a você</Badge>
          ) : conversation.assigned_to ? (
            <span className="text-xs text-muted-foreground">
              Com {assignedProfile?.full_name ?? "outro vendedor"}
            </span>
          ) : (
            <Badge variant="outline">Sem vendedor</Badge>
          )}
          {!isMine && canClaim && <ClaimButton conversationId={conversation.id} />}
          {canTransfer && transferTargets.length > 0 && (
            <TransferDialog conversationId={conversation.id} targets={transferTargets} />
          )}
          <StatusSelect conversationId={conversation.id} status={conversation.status} />
        </div>
      </div>

      <ConversationLabels
        conversationId={conversation.id}
        temperature={conversation.temperature as Temperature | null}
        allTags={orgTags ?? []}
        selectedTagIds={(conversationTags ?? []).map((t) => t.tag_id)}
      />

      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground">Nenhuma mensagem ainda.</p>
        ) : (
          messages.map((message) => <MessageBubble key={message.id} message={message} />)
        )}
      </div>

      <MessageForm
        conversationId={conversation.id}
        readOnly={readOnly}
        canClaim={canClaim}
        outsideWindow={outsideWindow}
        quickReplies={quickReplies ?? []}
        templates={(approvedTemplates ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
          bodyText: t.body_text,
          variableCount: t.variable_count,
        }))}
        contactName={contact?.name ?? null}
      />
    </div>
  );
}
