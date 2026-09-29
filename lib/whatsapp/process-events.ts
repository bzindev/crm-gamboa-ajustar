import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { tryAutoAssignFromRotation } from "@/lib/crm/rotation";
import { logAudit } from "@/lib/audit/log";
import { sendTemplateMessage } from "@/lib/whatsapp/graph-client";
import { mapGraphApiError } from "@/lib/whatsapp/errors";
import { decryptToken, pgByteaToBuffer } from "@/lib/crypto/token-cipher";
import { matchCsatAnswer, recordCsatAnswer } from "@/lib/whatsapp/csat-worker";
import { downloadMedia } from "@/lib/whatsapp/graph-client";
import { safeFileName } from "@/lib/whatsapp/media-rules";
import { createHash } from "node:crypto";

const MAX_ATTEMPTS = 5;
const MESSAGE_TYPES = new Set([
  "text",
  "image",
  "audio",
  "video",
  "document",
  "template",
  "sticker",
  "location",
  "contacts",
]);

type AdminClient = ReturnType<typeof createAdminClient>;

type ClaimedEvent = {
  id: string;
  org_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
};

type ProcessResult = { processed: number; failed: number };

// Drena a fila reivindicada por fn_claim_pending_events (FOR UPDATE SKIP
// LOCKED no banco — necessário porque o PostgREST não expõe lock de linha
// pela API REST). Processamento pesado do webhook (criar contato, conversa,
// mensagem) acontece aqui, fora do tempo de resposta do webhook.
export async function processPendingEvents(supabase: AdminClient, limit = 20): Promise<ProcessResult> {
  const { data, error } = await supabase.rpc("fn_claim_pending_events", { p_limit: limit });
  if (error) {
    console.error("[worker] falha ao reivindicar event_log:", error.code, error.message);
    return { processed: 0, failed: 0 };
  }

  const events = (data ?? []) as ClaimedEvent[];
  let processed = 0;
  let failed = 0;

  for (const event of events) {
    try {
      if (!event.org_id) {
        await markDone(supabase, event.id);
        continue;
      }

      if (event.type === "whatsapp_inbound_message") {
        await processInboundMessage(supabase, event.org_id, event.payload);
      } else if (event.type === "whatsapp_status_update") {
        await processStatusUpdate(supabase, event.org_id, event.payload);
      } else if (event.type === "whatsapp_bulk_message") {
        await processBulkMessage(supabase, event.org_id, event.payload);
      }
      // Tipo desconhecido (ex.: lead_stage_changed, sem consumidor ainda):
      // marca como concluído sem processar — não é erro, só não tem worker
      // ligado a esse tipo de evento.

      await markDone(supabase, event.id);
      processed += 1;
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : "Erro desconhecido.";
      await markFailed(supabase, event.id, event.attempts, message);
    }
  }

  return { processed, failed };
}

async function markDone(supabase: AdminClient, eventId: string) {
  await supabase
    .from("event_log")
    .update({ status: "done", processed_at: new Date().toISOString() })
    .eq("id", eventId);
}

async function markFailed(supabase: AdminClient, eventId: string, attempts: number, errorMessage: string) {
  const nextAttempts = attempts + 1;
  await supabase
    .from("event_log")
    .update({
      status: nextAttempts >= MAX_ATTEMPTS ? "dead" : "failed",
      attempts: nextAttempts,
      last_error: errorMessage,
    })
    .eq("id", eventId);
}

/** Exportada só pra teste (tests/inbound-media.test.ts) chamar sem passar pela fila, que o cron também drena. */
export async function processInboundMessage(supabase: AdminClient, orgId: string, payload: Record<string, unknown>) {
  const channelId = String(payload.channel_id ?? "");
  const waId = String(payload.wa_id ?? "");
  const wamid = String(payload.wamid ?? "");
  const messageType = String(payload.message_type ?? "text");
  const text = typeof payload.text === "string" ? payload.text : null;
  const contactName = typeof payload.contact_name === "string" ? payload.contact_name : null;

  if (!channelId || !waId || !wamid) {
    throw new Error("Payload de mensagem recebida incompleto.");
  }

  const phoneE164 = `+${waId}`;

  const { data: existingContact } = await supabase
    .from("contacts")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("phone_e164", phoneE164)
    .maybeSingle();

  let contactId = existingContact?.id as string | undefined;
  if (!contactId) {
    const { data: newContact, error } = await supabase
      .from("contacts")
      .insert({ org_id: orgId, phone_e164: phoneE164, name: contactName })
      .select("id")
      .single();
    if (error || !newContact) throw new Error(error?.message ?? "Falha ao criar contato.");
    contactId = newContact.id;
  } else if (contactName && !existingContact?.name) {
    await supabase.from("contacts").update({ name: contactName }).eq("id", contactId);
  }

  const { data: existingConversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("org_id", orgId)
    .eq("contact_id", contactId)
    .eq("channel_id", channelId)
    .maybeSingle();

  let conversationId = existingConversation?.id as string | undefined;
  let assignedTo: string | null = null;
  let csatAnswer: Awaited<ReturnType<typeof matchCsatAnswer>> = null;
  const nowIso = new Date().toISOString();

  if (!conversationId) {
    // Cliente novo entrando em contato: passa pelo rodízio do primeiro
    // setor com distribuição automática ligada (hoje só "Venda Veículos
    // Novos"). Sem setor assim, ou sem ninguém online, fica sem dono —
    // alguém pega manualmente pelo botão "assumir conversa".
    const { data: autoTeam } = await supabase
      .from("teams")
      .select("id")
      .eq("org_id", orgId)
      .eq("auto_distribution", true)
      .limit(1)
      .maybeSingle();

    assignedTo = autoTeam ? await tryAutoAssignFromRotation(supabase, orgId, autoTeam.id) : null;

    const { data: newConversation, error } = await supabase
      .from("conversations")
      .insert({
        org_id: orgId,
        contact_id: contactId,
        channel_id: channelId,
        status: "open",
        last_inbound_at: nowIso,
        team_id: autoTeam?.id ?? null,
        assigned_to: assignedTo,
        assigned_at: assignedTo ? nowIso : null,
      })
      .select("id")
      .single();
    if (error || !newConversation) throw new Error(error?.message ?? "Falha ao criar conversa.");
    conversationId = newConversation.id;

    if (assignedTo) {
      await logAudit(supabase, {
        orgId,
        actorId: null,
        action: "conversation.auto_assigned",
        resourceType: "conversations",
        resourceId: conversationId,
        after: { assigned_to: assignedTo, team_id: autoTeam?.id ?? null, via: "rodizio" },
      });
    }
  } else {
    const { data: current } = await supabase
      .from("conversations")
      .select("assigned_to")
      .eq("id", conversationId)
      .maybeSingle();
    assignedTo = current?.assigned_to ?? null;

    // Resposta de pesquisa de satisfação ("5") não reabre a conversa
    // resolvida — só registra a nota.
    csatAnswer = await matchCsatAnswer(supabase, { orgId, conversationId: conversationId!, wamid, text });

    await supabase
      .from("conversations")
      .update(csatAnswer ? { last_inbound_at: nowIso } : { last_inbound_at: nowIso, status: "open" })
      .eq("id", conversationId);
  }

  const content = await buildInboundContent(supabase, {
    orgId,
    channelId,
    conversationId: conversationId!,
    wamid,
    messageType,
    text,
    media: payload.media as InboundMedia | null | undefined,
    location: payload.location as Record<string, unknown> | null | undefined,
  });

  const { error: messageError } = await supabase.from("messages").insert({
    org_id: orgId,
    conversation_id: conversationId,
    wamid,
    direction: "inbound",
    type: MESSAGE_TYPES.has(messageType) ? messageType : "text",
    content,
    status: "received",
  });

  // 23505 = já processado antes (reprocessamento após queda do worker) —
  // idempotente, não é erro. Nesse caso não notifica de novo.
  if (messageError) {
    if (messageError.code !== "23505") throw new Error(messageError.message);
    return;
  }

  // Nota da pesquisa: registra e não notifica ninguém ("Nova mensagem: 5"
  // só seria barulho pro vendedor).
  if (csatAnswer) {
    if (!csatAnswer.alreadyRecorded) {
      await recordCsatAnswer(supabase, { surveyId: csatAnswer.surveyId, rating: csatAnswer.rating, wamid });
    }
    return;
  }

  const finalContactName = existingContact?.name ?? contactName;
  if (assignedTo) {
    // Conversa já tem dono (rodízio ou "assumir conversa" manual): só
    // avisa quem é responsável, não o time inteiro.
    await notifyOne(supabase, orgId, assignedTo, conversationId!, finalContactName, text ?? MEDIA_PREVIEW[messageType] ?? null);
  } else {
    await notifyAllAgents(supabase, orgId, conversationId!, finalContactName, text ?? MEDIA_PREVIEW[messageType] ?? null);
  }
}

function inboundMessageNotification(
  orgId: string,
  userId: string,
  conversationId: string,
  contactName: string | null,
  text: string | null,
) {
  return {
    org_id: orgId,
    user_id: userId,
    type: "whatsapp.message_received",
    title: contactName ? `Nova mensagem de ${contactName}` : "Nova mensagem no WhatsApp",
    body: text,
    link: `/inbox/${conversationId}`,
  };
}

async function notifyOne(
  supabase: AdminClient,
  orgId: string,
  userId: string,
  conversationId: string,
  contactName: string | null,
  text: string | null,
) {
  await supabase
    .from("notifications")
    .insert(inboundMessageNotification(orgId, userId, conversationId, contactName, text));
}

async function notifyAllAgents(
  supabase: AdminClient,
  orgId: string,
  conversationId: string,
  contactName: string | null,
  text: string | null,
) {
  const { data: members } = await supabase
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId)
    .not("accepted_at", "is", null);

  if (!members || members.length === 0) return;

  await supabase.from("notifications").insert(
    members.map((member) =>
      inboundMessageNotification(orgId, member.user_id, conversationId, contactName, text),
    ),
  );
}

// Erros de envio (número inválido, template rejeitado etc.) costumam ser
// permanentes — em vez de deixar o event_log tentar de novo até "morrer"
// (5x, mesma falha sempre), marca o destinatário como falho de uma vez e
// segue o lote. A campanha nunca trava por causa de um destinatário ruim.
async function processBulkMessage(supabase: AdminClient, orgId: string, payload: Record<string, unknown>) {
  const campaignId = String(payload.campaign_id ?? "");
  const contactId = String(payload.contact_id ?? "");
  if (!campaignId || !contactId) return;

  const { data: recipient } = await supabase
    .from("bulk_campaign_recipients")
    .select("id, status")
    .eq("campaign_id", campaignId)
    .eq("contact_id", contactId)
    .eq("org_id", orgId)
    .maybeSingle();

  // Já processado antes (reprocessamento após queda do worker) — idempotente.
  if (!recipient || recipient.status !== "pending") return;

  try {
    // org_id em todas as buscas abaixo: defesa em profundidade — o worker
    // usa o client de service role (ignora RLS), então quem garante que
    // tudo pertence à mesma organização é o código aqui, não o banco.
    const { data: campaign } = await supabase
      .from("bulk_campaigns")
      .select("template_id")
      .eq("id", campaignId)
      .eq("org_id", orgId)
      .single();
    if (!campaign) throw new Error("Campanha não encontrada.");

    const { data: template } = await supabase
      .from("message_templates")
      .select("name, language, variable_count, body_text")
      .eq("id", campaign.template_id)
      .eq("org_id", orgId)
      .single();
    if (!template) throw new Error("Template não encontrado.");

    const { data: contact } = await supabase
      .from("contacts")
      .select("name, phone_e164")
      .eq("id", contactId)
      .eq("org_id", orgId)
      .single();
    if (!contact) throw new Error("Contato não encontrado.");

    const { data: channel } = await supabase
      .from("channels")
      .select("id, phone_number_id, access_token_encrypted, status")
      .eq("org_id", orgId)
      .eq("status", "connected")
      .maybeSingle();
    if (!channel || !channel.access_token_encrypted) throw new Error("Canal do WhatsApp não conectado.");

    const accessToken = decryptToken(pgByteaToBuffer(channel.access_token_encrypted));
    const to = contact.phone_e164.replace(/^\+/, "");
    const bodyParams = template.variable_count > 0 ? [contact.name ?? contact.phone_e164] : [];

    const { wamid } = await sendTemplateMessage(
      channel.phone_number_id,
      accessToken,
      to,
      template.name,
      template.language,
      bodyParams,
    );

    // Mesma conversa que o chat normal usa — a resposta do cliente cai
    // direto nela, com o disparo já no histórico.
    const { data: existingConversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("org_id", orgId)
      .eq("contact_id", contactId)
      .eq("channel_id", channel.id)
      .maybeSingle();

    let conversationId = existingConversation?.id as string | undefined;
    if (!conversationId) {
      const { data: newConversation, error } = await supabase
        .from("conversations")
        .insert({ org_id: orgId, contact_id: contactId, channel_id: channel.id, status: "open" })
        .select("id")
        .single();
      if (error || !newConversation) throw new Error(error?.message ?? "Falha ao criar conversa.");
      conversationId = newConversation.id;
    }

    const renderedBody =
      bodyParams.length > 0 ? template.body_text.replace("{{1}}", bodyParams[0]) : template.body_text;

    await supabase.from("messages").insert({
      org_id: orgId,
      conversation_id: conversationId,
      wamid,
      direction: "outbound",
      type: "template",
      content: { body: renderedBody, template_name: template.name },
      status: "sent",
    });

    await supabase
      .from("conversations")
      .update({ last_outbound_at: new Date().toISOString() })
      .eq("id", conversationId);

    await supabase
      .from("bulk_campaign_recipients")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", recipient.id);
  } catch (err) {
    await supabase
      .from("bulk_campaign_recipients")
      .update({ status: "failed", error_message: mapGraphApiError(err) })
      .eq("id", recipient.id);
  }

  await refreshCampaignCounters(supabase, campaignId);
}

async function refreshCampaignCounters(supabase: AdminClient, campaignId: string) {
  const [{ count: sentCount }, { count: failedCount }, { count: pendingCount }] = await Promise.all([
    supabase
      .from("bulk_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "sent"),
    supabase
      .from("bulk_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "failed"),
    supabase
      .from("bulk_campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending"),
  ]);

  await supabase
    .from("bulk_campaigns")
    .update({
      sent_count: sentCount ?? 0,
      failed_count: failedCount ?? 0,
      status: (pendingCount ?? 0) > 0 ? "sending" : "done",
    })
    .eq("id", campaignId);
}

async function processStatusUpdate(supabase: AdminClient, orgId: string, payload: Record<string, unknown>) {
  const wamid = String(payload.wamid ?? "");
  const status = String(payload.status ?? "");
  const validStatuses = new Set(["sent", "delivered", "read", "failed"]);

  if (!wamid || !validStatuses.has(status)) return;

  // A Meta não garante ordem: um "delivered" atrasado pode chegar depois do
  // "read". Status só avança (enviado → entregue → lido); "failed" vale
  // sempre, porque é definitivo.
  const allowedPrevious: Record<string, string[]> = {
    sent: ["received", "sent"],
    delivered: ["received", "sent", "delivered"],
    read: ["received", "sent", "delivered", "read"],
    failed: ["received", "sent", "delivered", "read", "failed"],
  };

  await supabase
    .from("messages")
    .update({ status })
    .eq("org_id", orgId)
    .eq("wamid", wamid)
    .in("status", allowedPrevious[status]);
}

// ---------------------------------------------------------------------------
// Mídia recebida
// ---------------------------------------------------------------------------

type InboundMedia = { id: string; mime_type: string | null; caption: string | null; filename: string | null };

const MEDIA_PREVIEW: Record<string, string> = {
  image: "📷 Foto",
  video: "🎥 Vídeo",
  audio: "🎤 Áudio",
  document: "📄 Documento",
  sticker: "Figurinha",
  location: "📍 Localização",
};

const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
};

/**
 * Monta o conteúdo da mensagem recebida. Mídia: baixa da Meta na hora (a
 * URL que ela dá expira em minutos) e guarda no bucket privado. Caminho
 * derivado do wamid, com upsert — se o worker reprocessar a mesma
 * mensagem, sobrescreve o mesmo arquivo em vez de duplicar. Se o download
 * falhar, a mensagem entra do mesmo jeito marcada como indisponível: não
 * vale travar a fila (e perder o texto/legenda) por causa do arquivo.
 */
async function buildInboundContent(
  supabase: AdminClient,
  params: {
    orgId: string;
    channelId: string;
    conversationId: string;
    wamid: string;
    messageType: string;
    text: string | null;
    media: InboundMedia | null | undefined;
    location: Record<string, unknown> | null | undefined;
  },
): Promise<Record<string, unknown> | null> {
  if (params.location) return { body: null, location: params.location };
  if (!params.media) return params.text ? { body: params.text } : null;

  const mime = (params.media.mime_type ?? "application/octet-stream").split(";")[0].trim();
  const fallbackName = `${params.messageType}.${EXTENSION[mime] ?? "bin"}`;
  const filename = safeFileName(params.media.filename ?? fallbackName);
  const base = { body: params.media.caption ?? null };

  try {
    const { data: channel } = await supabase
      .from("channels")
      .select("access_token_encrypted")
      .eq("id", params.channelId)
      .eq("org_id", params.orgId)
      .single();
    if (!channel?.access_token_encrypted) throw new Error("canal sem token");

    const file = await downloadMedia(params.media.id, decryptToken(pgByteaToBuffer(channel.access_token_encrypted)));
    const folder = createHash("sha256").update(params.wamid).digest("hex").slice(0, 24);
    const path = `${params.orgId}/${params.conversationId}/in-${folder}/${filename}`;
    const { error } = await supabase.storage
      .from("chat-media")
      .upload(path, file.data, { contentType: file.mimeType, upsert: true });
    if (error) throw new Error(error.message);

    return { ...base, media: { path, mime: file.mimeType, filename, size: file.data.byteLength } };
  } catch (err) {
    console.error("[worker] falha ao baixar mídia recebida:", err instanceof Error ? err.message : err);
    return { ...base, media: { mime, filename, unavailable: true } };
  }
}
