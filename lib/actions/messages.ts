"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { sendMessageSchema } from "@/lib/validation/messages";
import { sendTextMessage } from "@/lib/whatsapp/graph-client";
import { mapGraphApiError } from "@/lib/whatsapp/errors";
import { decryptToken, pgByteaToBuffer } from "@/lib/crypto/token-cipher";
import { isWithin24hWindow } from "@/lib/whatsapp/window";

export type MessageActionState = { error?: string } | null;

type ConversationRow = {
  id: string;
  org_id: string;
  last_inbound_at: string | null;
  contacts: { phone_e164: string } | { phone_e164: string }[] | null;
  channels:
    | { phone_number_id: string; status: string; access_token_encrypted: string | null }
    | { phone_number_id: string; status: string; access_token_encrypted: string | null }[]
    | null;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function sendMessage(
  _prevState: MessageActionState,
  formData: FormData,
): Promise<MessageActionState> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id, org_id, last_inbound_at, contacts(phone_e164), channels(phone_number_id, status, access_token_encrypted)")
    .eq("id", parsed.data.conversationId)
    .eq("org_id", membership.orgId)
    .maybeSingle<ConversationRow>();

  if (!conversation) {
    return { error: "Conversa não encontrada." };
  }

  const contact = one(conversation.contacts);
  const channel = one(conversation.channels);

  if (!channel || channel.status !== "connected" || !channel.access_token_encrypted) {
    return { error: "Canal do WhatsApp não está conectado." };
  }
  if (!contact) {
    return { error: "Contato da conversa não encontrado." };
  }

  if (!isWithin24hWindow(conversation.last_inbound_at)) {
    return {
      error: "Fora da janela de 24h — só é possível responder com um template aprovado.",
    };
  }

  const accessToken = decryptToken(pgByteaToBuffer(channel.access_token_encrypted));
  const to = contact.phone_e164.replace(/^\+/, "");

  let wamid: string;
  try {
    const result = await sendTextMessage(channel.phone_number_id, accessToken, to, parsed.data.body);
    wamid = result.wamid;
  } catch (err) {
    return { error: mapGraphApiError(err) };
  }

  const now = new Date().toISOString();

  const { error: insertError } = await supabase.from("messages").insert({
    org_id: membership.orgId,
    conversation_id: conversation.id,
    wamid,
    direction: "outbound",
    type: "text",
    content: { body: parsed.data.body },
    status: "sent",
    sent_by: membership.userId,
  });

  if (insertError) {
    console.error("[messages] falha ao salvar mensagem enviada:", insertError.code, insertError.message);
    return { error: "Mensagem enviada, mas não foi possível salvar no histórico." };
  }

  await supabase.from("conversations").update({ last_outbound_at: now }).eq("id", conversation.id);

  revalidatePath(`/inbox/${conversation.id}`);
  return null;
}
