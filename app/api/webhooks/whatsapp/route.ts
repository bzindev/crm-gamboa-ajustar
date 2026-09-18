import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookSignature } from "@/lib/whatsapp/webhook-signature";
import { webhookPayloadSchema, type WebhookMessage, type WebhookStatus } from "@/lib/whatsapp/webhook-schema";

// GET: handshake de verificação que a Meta faz uma vez ao salvar a URL do
// webhook no painel. Só responde o challenge se o verify_token bater com o
// que está configurado no servidor — senão 403, sem eco de nada.
export async function GET(request: NextRequest) {
  const mode = request.nextUrl.searchParams.get("hub.mode");
  const token = request.nextUrl.searchParams.get("hub.verify_token");
  const challenge = request.nextUrl.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// POST: precisa responder 200 em menos de 5s. Grava a entrega bruta e
// enfileira em event_log; quem processa de verdade (criar contato,
// conversa, mensagem) é o worker em /api/cron/process-events, fora do
// tempo de resposta do webhook (ver CLAUDE.md, seção "Webhook do WhatsApp").
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signatureHeader = request.headers.get("x-hub-signature-256");

  const appSecret = process.env.WHATSAPP_APP_SECRET;
  if (!appSecret || !verifyWebhookSignature(rawBody, signatureHeader, appSecret)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const parsed = webhookPayloadSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ ok: true });
  }

  const supabase = createAdminClient();

  for (const entry of parsed.data.entry) {
    for (const change of entry.changes) {
      const value = change.value;
      const phoneNumberId = value.metadata.phone_number_id;

      const { data: channel } = await supabase
        .from("channels")
        .select("id, org_id")
        .eq("phone_number_id", phoneNumberId)
        .maybeSingle();

      await supabase.from("webhook_deliveries").insert({
        org_id: channel?.org_id ?? null,
        phone_number_id: phoneNumberId,
        payload: change,
        signature_valid: true,
      });

      // Sem canal cadastrado para esse phone_number_id: não tem organização
      // para enfileirar o evento. Registrado acima para investigar depois,
      // mas não derruba o webhook (a Meta reenvia se responder erro).
      if (!channel) continue;

      for (const message of value.messages ?? []) {
        await enqueueInboundMessage(supabase, channel.org_id, channel.id, value.contacts, message);
      }
      for (const status of value.statuses ?? []) {
        await enqueueStatusUpdate(supabase, channel.org_id, status);
      }
    }
  }

  return NextResponse.json({ ok: true });
}

async function enqueueInboundMessage(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  channelId: string,
  contacts: { wa_id: string; profile?: { name?: string } }[] | undefined,
  message: WebhookMessage,
) {
  const contactName = contacts?.find((c) => c.wa_id === message.from)?.profile?.name ?? null;

  const { error } = await supabase.from("event_log").insert({
    org_id: orgId,
    type: "whatsapp_inbound_message",
    payload: {
      channel_id: channelId,
      wa_id: message.from,
      contact_name: contactName,
      wamid: message.id,
      message_type: message.type,
      text: message.text?.body ?? null,
      timestamp: message.timestamp,
    },
    dedupe_key: `whatsapp_inbound:${message.id}`,
  });

  // 23505 = unique_violation no dedupe_key: a Meta reentregou o mesmo
  // webhook — esperado, não é erro (ver CLAUDE.md, regra 5).
  if (error && error.code !== "23505") {
    console.error("[webhook] falha ao enfileirar mensagem:", error.code, error.message);
  }
}

async function enqueueStatusUpdate(
  supabase: ReturnType<typeof createAdminClient>,
  orgId: string,
  status: WebhookStatus,
) {
  const { error } = await supabase.from("event_log").insert({
    org_id: orgId,
    type: "whatsapp_status_update",
    payload: { wamid: status.id, status: status.status, timestamp: status.timestamp },
    dedupe_key: `whatsapp_status:${status.id}:${status.status}`,
  });

  if (error && error.code !== "23505") {
    console.error("[webhook] falha ao enfileirar status:", error.code, error.message);
  }
}
