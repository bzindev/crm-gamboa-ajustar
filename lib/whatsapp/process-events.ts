import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";

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
  const nowIso = new Date().toISOString();

  if (!conversationId) {
    const { data: newConversation, error } = await supabase
      .from("conversations")
      .insert({
        org_id: orgId,
        contact_id: contactId,
        channel_id: channelId,
        status: "open",
        last_inbound_at: nowIso,
      })
      .select("id")
      .single();
    if (error || !newConversation) throw new Error(error?.message ?? "Falha ao criar conversa.");
    conversationId = newConversation.id;
  } else {
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
  // idempotente, não é erro.
  if (messageError && messageError.code !== "23505") {
    throw new Error(messageError.message);
  }
}

async function processStatusUpdate(supabase: AdminClient, orgId: string, payload: Record<string, unknown>) {
  const wamid = String(payload.wamid ?? "");
  const status = String(payload.status ?? "");
  const validStatuses = new Set(["sent", "delivered", "read", "failed"]);

  if (!wamid || !validStatuses.has(status)) return;

  await supabase.from("messages").update({ status }).eq("org_id", orgId).eq("wamid", wamid);
}
