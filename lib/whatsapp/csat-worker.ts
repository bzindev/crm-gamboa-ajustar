import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { sendTextMessage } from "@/lib/whatsapp/graph-client";
import { mapGraphApiError } from "@/lib/whatsapp/errors";
import { decryptToken, pgByteaToBuffer } from "@/lib/crypto/token-cipher";
import { isWithin24hWindow } from "@/lib/whatsapp/window";
import { parseCsatRating } from "@/lib/crm/csat";

type AdminClient = ReturnType<typeof createAdminClient>;

/** Quanto tempo depois do envio uma resposta "5" ainda conta como nota. */
const ANSWER_WINDOW_HOURS = 48;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Chamado pelo cron de 1 em 1 minuto. A pesquisa nasce "pending" quando a
 * conversa é marcada como resolvida (lib/actions/conversations.ts); aqui
 * ela é enviada de fato. Fora da janela de 24h da Meta não dá pra mandar
 * texto livre — vira "skipped" em vez de falhar tentando.
 */
export async function processPendingCsat(supabase: AdminClient, limit = 20): Promise<number> {
  const { data: pending } = await supabase
    .from("csat_surveys")
    .select("id, org_id, conversation_id")
    .eq("status", "pending")
    .order("created_at")
    .limit(limit);

  let sent = 0;
  for (const survey of pending ?? []) {
    if (await sendOne(supabase, survey)) sent += 1;
  }
  return sent;
}

async function sendOne(
  supabase: AdminClient,
  survey: { id: string; org_id: string; conversation_id: string },
): Promise<boolean> {
  const mark = (fields: Record<string, unknown>) =>
    supabase.from("csat_surveys").update(fields).eq("id", survey.id).eq("status", "pending");

  // org_id em todas as buscas: client de service role ignora RLS, então o
  // limite de organização é garantido aqui no código.
  const [{ data: org }, { data: conversation }] = await Promise.all([
    supabase.from("organizations").select("csat_enabled, csat_message").eq("id", survey.org_id).single(),
    supabase
      .from("conversations")
      .select("id, last_inbound_at, contacts(phone_e164, anonymized_at), channels(phone_number_id, status, access_token_encrypted)")
      .eq("id", survey.conversation_id)
      .eq("org_id", survey.org_id)
      .maybeSingle(),
  ]);

  const contact = one(conversation?.contacts ?? null) as { phone_e164: string; anonymized_at: string | null } | null;
  const channel = one(conversation?.channels ?? null) as
    | { phone_number_id: string; status: string; access_token_encrypted: string | null }
    | null;

  if (!org?.csat_enabled || !conversation || !contact || contact.anonymized_at) {
    await mark({ status: "skipped", error_message: "Pesquisa desligada ou contato indisponível." });
    return false;
  }
  if (!isWithin24hWindow(conversation.last_inbound_at)) {
    await mark({ status: "skipped", error_message: "Fora da janela de 24h da Meta." });
    return false;
  }
  if (!channel || channel.status !== "connected" || !channel.access_token_encrypted) {
    await mark({ status: "failed", error_message: "Canal do WhatsApp não conectado." });
    return false;
  }

  try {
    const accessToken = decryptToken(pgByteaToBuffer(channel.access_token_encrypted));
    const { wamid } = await sendTextMessage(
      channel.phone_number_id,
      accessToken,
      contact.phone_e164.replace(/^\+/, ""),
      org.csat_message,
    );
    const nowIso = new Date().toISOString();
    await supabase.from("messages").insert({
      org_id: survey.org_id,
      conversation_id: survey.conversation_id,
      wamid,
      direction: "outbound",
      type: "text",
      content: { body: org.csat_message, csat: true },
      status: "sent",
    });
    await mark({ status: "sent", sent_at: nowIso });
    return true;
  } catch (err) {
    await mark({ status: "failed", error_message: mapGraphApiError(err) });
    return false;
  }
}

/**
 * Se a mensagem do cliente é a resposta de uma pesquisa enviada há pouco,
 * devolve a pesquisa e a nota. Também reconhece a MESMA mensagem já
 * registrada antes (answer_wamid) — reprocessamento do worker não pode
 * reabrir a conversa nem registrar duas vezes.
 */
export async function matchCsatAnswer(
  supabase: AdminClient,
  params: { orgId: string; conversationId: string; wamid: string; text: string | null },
): Promise<{ surveyId: string; rating: number; alreadyRecorded: boolean } | null> {
  const rating = parseCsatRating(params.text);
  if (rating === null) return null;

  // Duas consultas simples em vez de um .or() montado com texto — o wamid
  // vem de fora (Meta) e nunca entra como pedaço de filtro.
  const { data: recorded } = await supabase
    .from("csat_surveys")
    .select("id")
    .eq("org_id", params.orgId)
    .eq("conversation_id", params.conversationId)
    .eq("answer_wamid", params.wamid)
    .maybeSingle();
  if (recorded) return { surveyId: recorded.id, rating, alreadyRecorded: true };

  const since = new Date(Date.now() - ANSWER_WINDOW_HOURS * 3600_000).toISOString();
  const { data: open } = await supabase
    .from("csat_surveys")
    .select("id")
    .eq("org_id", params.orgId)
    .eq("conversation_id", params.conversationId)
    .eq("status", "sent")
    .gte("sent_at", since)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return open ? { surveyId: open.id, rating, alreadyRecorded: false } : null;
}

export async function recordCsatAnswer(
  supabase: AdminClient,
  params: { surveyId: string; rating: number; wamid: string },
): Promise<void> {
  await supabase
    .from("csat_surveys")
    .update({ status: "answered", rating: params.rating, answer_wamid: params.wamid, answered_at: new Date().toISOString() })
    .eq("id", params.surveyId)
    .eq("status", "sent");
}
