"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import type { ActiveOrgMembership } from "@/lib/auth/session";
import { sendMessageSchema } from "@/lib/validation/messages";
import { sendTextMessage, uploadMedia, sendMediaMessage as sendMediaToMeta, sendLocationMessage } from "@/lib/whatsapp/graph-client";
import { mapGraphApiError } from "@/lib/whatsapp/errors";
import { decryptToken, pgByteaToBuffer } from "@/lib/crypto/token-cipher";
import { isWithin24hWindow } from "@/lib/whatsapp/window";
import { kindForMime, validateMediaFile, safeFileName } from "@/lib/whatsapp/media-rules";
import { logAudit } from "@/lib/audit/log";

export type MessageActionState = { error?: string } | null;

const MEDIA_BUCKET = "chat-media";

type ConversationRow = {
  id: string;
  org_id: string;
  last_inbound_at: string | null;
  assigned_to: string | null;
  contacts: { phone_e164: string; anonymized_at: string | null } | { phone_e164: string; anonymized_at: string | null }[] | null;
  channels:
    | { phone_number_id: string; status: string; access_token_encrypted: string | null }
    | { phone_number_id: string; status: string; access_token_encrypted: string | null }[]
    | null;
};

type SendContext = {
  membership: ActiveOrgMembership;
  supabase: Awaited<ReturnType<typeof createClient>>;
  conversationId: string;
  assignedTo: string | null;
  phoneNumberId: string;
  accessToken: string;
  to: string;
};

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Tudo que precisa ser verdade antes de mandar QUALQUER coisa (texto, foto,
 * localização): conversa desta organização, canal conectado, janela de 24h
 * aberta e — regra de todo papel, sem exceção — só fala quem está atribuído
 * (ou ninguém ainda, aí enviar já assume). Gestor que quiser intervir numa
 * conversa de outro vendedor precisa clicar "Assumir conversa" antes.
 */
async function loadSendContext(conversationId: string): Promise<{ error: string } | { ctx: SendContext }> {
  let membership;
  try {
    membership = await requireRole("agent");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const supabase = await createClient();
  const { data: conversation } = await supabase
    .from("conversations")
    .select(
      "id, org_id, last_inbound_at, assigned_to, contacts(phone_e164, anonymized_at), channels(phone_number_id, status, access_token_encrypted)",
    )
    .eq("id", conversationId)
    .eq("org_id", membership.orgId)
    .maybeSingle<ConversationRow>();

  if (!conversation) return { error: "Conversa não encontrada." };

  const contact = one(conversation.contacts);
  const channel = one(conversation.channels);

  if (!channel || channel.status !== "connected" || !channel.access_token_encrypted) {
    return { error: "Canal do WhatsApp não está conectado." };
  }
  if (!contact) return { error: "Contato da conversa não encontrado." };
  if (contact.anonymized_at) return { error: "Esse contato foi anonimizado (LGPD) — não dá mais pra enviar mensagens." };
  if (conversation.assigned_to && conversation.assigned_to !== membership.userId) {
    return { error: "Essa conversa está com outro vendedor. Assuma antes de responder." };
  }
  if (!isWithin24hWindow(conversation.last_inbound_at)) {
    return { error: "Fora da janela de 24h — só é possível responder com um template aprovado." };
  }

  return {
    ctx: {
      membership,
      supabase,
      conversationId: conversation.id,
      assignedTo: conversation.assigned_to,
      phoneNumberId: channel.phone_number_id,
      accessToken: decryptToken(pgByteaToBuffer(channel.access_token_encrypted)),
      to: contact.phone_e164.replace(/^\+/, ""),
    },
  };
}

/** Responder uma conversa livre já assume ela. */
async function claimIfUnassigned(ctx: SendContext) {
  if (ctx.assignedTo) return;
  await ctx.supabase
    .from("conversations")
    .update({ assigned_to: ctx.membership.userId, assigned_at: new Date().toISOString() })
    .eq("id", ctx.conversationId);
  await logAudit(ctx.supabase, {
    orgId: ctx.membership.orgId,
    actorId: ctx.membership.userId,
    action: "conversation.claimed",
    resourceType: "conversations",
    resourceId: ctx.conversationId,
    before: { assigned_to: null },
    after: { assigned_to: ctx.membership.userId, via: "reply" },
  });
}

async function saveOutbound(ctx: SendContext, message: { wamid: string; type: string; content: Record<string, unknown> }) {
  const { error } = await ctx.supabase.from("messages").insert({
    org_id: ctx.membership.orgId,
    conversation_id: ctx.conversationId,
    wamid: message.wamid,
    direction: "outbound",
    type: message.type,
    content: message.content,
    status: "sent",
    sent_by: ctx.membership.userId,
  });
  if (error) {
    console.error("[messages] falha ao salvar mensagem enviada:", error.code, error.message);
    return "Mensagem enviada, mas não foi possível salvar no histórico.";
  }
  await ctx.supabase.from("conversations").update({ last_outbound_at: new Date().toISOString() }).eq("id", ctx.conversationId);
  revalidatePath(`/inbox/${ctx.conversationId}`);
  return null;
}

export async function sendMessage(
  _prevState: MessageActionState,
  formData: FormData,
): Promise<MessageActionState> {
  const parsed = sendMessageSchema.safeParse({
    conversationId: formData.get("conversationId"),
    body: formData.get("body"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const loaded = await loadSendContext(parsed.data.conversationId);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx } = loaded;
  await claimIfUnassigned(ctx);

  let wamid: string;
  try {
    ({ wamid } = await sendTextMessage(ctx.phoneNumberId, ctx.accessToken, ctx.to, parsed.data.body));
  } catch (err) {
    return { error: mapGraphApiError(err) };
  }

  const saveError = await saveOutbound(ctx, { wamid, type: "text", content: { body: parsed.data.body } });
  return saveError ? { error: saveError } : null;
}

// ---------------------------------------------------------------------------
// Mídia: o navegador sobe o arquivo DIRETO pro Storage (link assinado de
// uso único) e só depois pede o envio — o arquivo não passa pelo servidor
// na subida, então não esbarra no limite de ~4,5 MB por requisição da Vercel.
// ---------------------------------------------------------------------------

const prepareSchema = z.object({
  conversationId: z.string().uuid(),
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(160),
  size: z.number().int().positive(),
});

export async function prepareMediaUpload(
  input: z.input<typeof prepareSchema>,
): Promise<{ error: string } | { path: string; token: string }> {
  const parsed = prepareSchema.safeParse(input);
  if (!parsed.success) return { error: "Arquivo inválido." };

  const invalid = validateMediaFile(parsed.data.mimeType, parsed.data.size);
  if (invalid) return { error: invalid };

  // Mesmas regras do envio — melhor recusar antes de subir o arquivo.
  const loaded = await loadSendContext(parsed.data.conversationId);
  if ("error" in loaded) return { error: loaded.error };

  // Caminho montado AQUI, com a organização e a conversa já conferidas —
  // o navegador não escolhe onde o arquivo cai.
  const path = `${loaded.ctx.membership.orgId}/${loaded.ctx.conversationId}/${crypto.randomUUID()}/${safeFileName(parsed.data.fileName)}`;
  const { data, error } = await createAdminClient().storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("[messages] createSignedUploadUrl falhou:", error?.message);
    return { error: "Não foi possível preparar o envio do arquivo." };
  }
  return { path: data.path, token: data.token };
}

const sendMediaSchema = z.object({
  conversationId: z.string().uuid(),
  path: z.string().min(1).max(600),
  mimeType: z.string().min(1).max(160),
  fileName: z.string().min(1).max(255),
  caption: z.string().trim().max(1024).optional(),
});

export async function sendMediaMessage(input: z.input<typeof sendMediaSchema>): Promise<MessageActionState> {
  const parsed = sendMediaSchema.safeParse(input);
  if (!parsed.success) return { error: "Dados do arquivo inválidos." };

  const loaded = await loadSendContext(parsed.data.conversationId);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx } = loaded;

  // O caminho vem do navegador nesta etapa: só vale se for desta
  // organização E desta conversa (o prefixo que prepareMediaUpload gerou).
  const prefix = `${ctx.membership.orgId}/${ctx.conversationId}/`;
  if (!parsed.data.path.startsWith(prefix) || parsed.data.path.includes("..")) {
    return { error: "Arquivo inválido." };
  }

  const storage = createAdminClient().storage.from(MEDIA_BUCKET);
  const { data: blob, error: downloadError } = await storage.download(parsed.data.path);
  if (downloadError || !blob) return { error: "Não encontramos o arquivo enviado. Tente de novo." };

  // Tamanho real (do Storage), não o que o navegador disse.
  const invalid = validateMediaFile(parsed.data.mimeType, blob.size);
  const kind = kindForMime(parsed.data.mimeType);
  if (invalid || !kind) {
    await storage.remove([parsed.data.path]);
    return { error: invalid ?? "Tipo de arquivo não aceito." };
  }

  await claimIfUnassigned(ctx);

  const caption = parsed.data.caption || undefined;
  let wamid: string;
  try {
    const mediaId = await uploadMedia(ctx.phoneNumberId, ctx.accessToken, blob, parsed.data.mimeType, parsed.data.fileName);
    ({ wamid } = await sendMediaToMeta(ctx.phoneNumberId, ctx.accessToken, ctx.to, {
      kind,
      mediaId,
      caption,
      fileName: parsed.data.fileName,
    }));
  } catch (err) {
    await storage.remove([parsed.data.path]);
    return { error: mapGraphApiError(err) };
  }

  const saveError = await saveOutbound(ctx, {
    wamid,
    type: kind,
    content: {
      body: kind === "audio" ? null : (caption ?? null),
      media: { path: parsed.data.path, mime: parsed.data.mimeType, filename: parsed.data.fileName, size: blob.size },
    },
  });
  return saveError ? { error: saveError } : null;
}

const locationSchema = z.object({
  conversationId: z.string().uuid(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(200).optional(),
  address: z.string().trim().max(300).optional(),
});

export async function sendLocation(input: z.input<typeof locationSchema>): Promise<MessageActionState> {
  const parsed = locationSchema.safeParse(input);
  if (!parsed.success) return { error: "Localização inválida." };

  const loaded = await loadSendContext(parsed.data.conversationId);
  if ("error" in loaded) return { error: loaded.error };
  const { ctx } = loaded;
  await claimIfUnassigned(ctx);

  const location = {
    latitude: parsed.data.latitude,
    longitude: parsed.data.longitude,
    ...(parsed.data.name ? { name: parsed.data.name } : {}),
    ...(parsed.data.address ? { address: parsed.data.address } : {}),
  };

  let wamid: string;
  try {
    ({ wamid } = await sendLocationMessage(ctx.phoneNumberId, ctx.accessToken, ctx.to, location));
  } catch (err) {
    return { error: mapGraphApiError(err) };
  }

  const saveError = await saveOutbound(ctx, { wamid, type: "location", content: { body: null, location } });
  return saveError ? { error: saveError } : null;
}
