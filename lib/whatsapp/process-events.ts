import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { tryAutoAssignFromRotation } from "@/lib/crm/rotation";
import { logAudit } from "@/lib/audit/log";
import { sendTemplateMessage } from "@/lib/whatsapp/graph-client";
import { mapGraphApiError } from "@/lib/whatsapp/errors";
import { decryptToken, pgByteaToBuffer } from "@/lib/crypto/token-cipher";

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

async function processInboundMessage(supabase: AdminClient, orgId: string, payload: Record<string, unknown>) {
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

    assignedTo = autoTeam ? await tryAutoAssignFromRotation(supabase, autoTeam.id) : null;

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

    await supabase
      .from("conversations")
      .update({ last_inbound_at: nowIso, status: "open" })
      .eq("id", conversationId);
  }

  const { error: messageError } = await supabase.from("messages").insert({
    org_id: orgId,
    conversation_id: conversationId,
    wamid,
    direction: "inbound",
    type: MESSAGE_TYPES.has(messageType) ? messageType : "text",
    content: text ? { body: text } : null,
    status: "received",
  });

  // 23505 = já processado antes (reprocessamento após queda do worker) —
  // idempotente, não é erro. Nesse caso não notifica de novo.
  if (messageError) {
    if (messageError.code !== "23505") throw new Error(messageError.message);
    return;
  }

  const finalContactName = existingContact?.name ?? contactName;
  if (assignedTo) {
    // Conversa já tem dono (rodízio ou "assumir conversa" manual): só
    // avisa quem é responsável, não o time inteiro.
    await notifyOne(supabase, orgId, assignedTo, conversationId!, finalContactName, text);
  } else {
    await notifyAllAgents(supabase, orgId, conversationId!, finalContactName, text);
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

  await supabase.from("messages").update({ status }).eq("org_id", orgId).eq("wamid", wamid);
}
