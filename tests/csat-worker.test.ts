import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { processPendingCsat } from "@/lib/whatsapp/csat-worker";
import { processPendingEvents } from "@/lib/whatsapp/process-events";

/**
 * Worker de CSAT contra o banco real. Não manda WhatsApp de verdade: o
 * canal de teste não tem token, então o caminho de envio para em "failed".
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

describe.skipIf(!hasCredentials)("pesquisa de satisfação (worker)", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const digits = `5511966${String(suffix).slice(-6)}`;
  let orgId: string;
  let channelId: string;
  let contactId: string;
  let conversationId: string;

  const recent = () => new Date(Date.now() - 10 * 60_000).toISOString();

  async function survey(fields: Record<string, unknown>) {
    return (await admin.from("csat_surveys").insert({ org_id: orgId, conversation_id: conversationId, contact_id: contactId, ...fields }).select().single().throwOnError()).data!;
  }

  async function statusOf(id: string) {
    return (await admin.from("csat_surveys").select("status, rating, error_message, answer_wamid").eq("id", id).single()).data!;
  }

  /** Enfileira como o webhook faria e espera o worker processar (o cron local pode pegar antes — tanto faz). */
  async function receive(wamid: string, text: string) {
    const { data: event } = await admin.from("event_log").insert({
      org_id: orgId,
      type: "whatsapp_inbound_message",
      payload: { channel_id: channelId, wa_id: digits, wamid, message_type: "text", text },
    }).select("id").single().throwOnError();
    for (let i = 0; i < 20; i++) {
      await processPendingEvents(admin as never);
      const { data } = await admin.from("event_log").select("status").eq("id", event!.id).single();
      if (data?.status === "done") return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error("evento não foi processado");
  }

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    orgId = (await admin.from("organizations").insert({ name: "Org CSAT", slug: `org-teste-csat-${suffix}` }).select().single().throwOnError()).data!.id;
    channelId = (await admin.from("channels").insert({ org_id: orgId, waba_id: `waba-csat-${suffix}`, phone_number_id: `pn-csat-${suffix}`, status: "connected" }).select().single().throwOnError()).data!.id;
    contactId = (await admin.from("contacts").insert({ org_id: orgId, name: "Cliente CSAT", phone_e164: `+${digits}` }).select().single().throwOnError()).data!.id;
    conversationId = (await admin.from("conversations").insert({ org_id: orgId, contact_id: contactId, channel_id: channelId, status: "resolved", last_inbound_at: recent() }).select().single().throwOnError()).data!.id;
  });

  afterAll(async () => {
    await admin.from("event_log").delete().eq("org_id", orgId);
    await admin.from("webhook_deliveries").delete().eq("org_id", orgId);
    await admin.from("organizations").delete().eq("id", orgId);
  });

  it("pesquisa desligada: não envia, marca como pulada", async () => {
    const s = await survey({});
    await processPendingCsat(admin as never, 50);
    expect((await statusOf(s.id)).status).toBe("skipped");
  });

  it("ligada mas fora da janela de 24h da Meta: pula", async () => {
    await admin.from("organizations").update({ csat_enabled: true }).eq("id", orgId).throwOnError();
    await admin.from("conversations").update({ last_inbound_at: new Date(Date.now() - 30 * 3600_000).toISOString() }).eq("id", conversationId).throwOnError();
    const s = await survey({});
    await processPendingCsat(admin as never, 50);
    expect(await statusOf(s.id)).toMatchObject({ status: "skipped", error_message: "Fora da janela de 24h da Meta." });
  });

  it("dentro da janela, mas canal sem token: registra a falha em vez de travar", async () => {
    await admin.from("conversations").update({ last_inbound_at: recent() }).eq("id", conversationId).throwOnError();
    const s = await survey({});
    await processPendingCsat(admin as never, 50);
    expect(await statusOf(s.id)).toMatchObject({ status: "failed", error_message: "Canal do WhatsApp não conectado." });
  });

  it("cliente responde '5': vira nota, conversa continua resolvida, ninguém é notificado", async () => {
    const s = await survey({ status: "sent", sent_at: new Date().toISOString() });
    await receive(`wamid.csat-${suffix}`, "5");

    expect(await statusOf(s.id)).toMatchObject({ status: "answered", rating: 5, answer_wamid: `wamid.csat-${suffix}` });
    const { data: conv } = await admin.from("conversations").select("status").eq("id", conversationId).single();
    expect(conv!.status).toBe("resolved");
    const { count } = await admin.from("notifications").select("*", { count: "exact", head: true }).eq("org_id", orgId);
    expect(count).toBe(0);
  });

  it("a mesma mensagem reprocessada não reabre nem registra de novo", async () => {
    await receive(`wamid.csat-${suffix}`, "5");
    const { data: conv } = await admin.from("conversations").select("status").eq("id", conversationId).single();
    expect(conv!.status).toBe("resolved");
    const { count } = await admin.from("csat_surveys").select("*", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("status", "answered");
    expect(count).toBe(1);
  });

  it("mensagem normal depois disso reabre a conversa", async () => {
    await receive(`wamid.normal-${suffix}`, "quero ver outro carro");
    const { data: conv } = await admin.from("conversations").select("status").eq("id", conversationId).single();
    expect(conv!.status).toBe("open");
  });
});
