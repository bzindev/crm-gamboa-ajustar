import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/** Migration 0026 contra o banco real — anonimizar apaga dado de verdade, então precisa de prova. */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

describe.skipIf(!hasCredentials)("LGPD: anonimizar e retenção", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const password = "senha-de-teste-123";
  const users: Record<string, string> = {};
  let orgId: string;
  let otherOrgId: string;
  let contactId: string;
  let leadId: string;
  let conversationId: string;
  const digits = `5511977${String(suffix).slice(-6)}`;
  const email = (k: string) => `teste-lgpd-${k}-${suffix}@example.com`;

  // Uma sessão por usuário, reaproveitada (limite de logins do Supabase).
  const sessions = new Map<string, Promise<SupabaseClient>>();
  function as(key: string) {
    if (!sessions.has(key)) {
      sessions.set(key, (async () => {
        const client = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
        const { error } = await client.auth.signInWithPassword({ email: email(key), password });
        if (error) throw error;
        return client;
      })());
    }
    return sessions.get(key)!;
  }

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    orgId = (await admin.from("organizations").insert({ name: "Org LGPD", slug: `org-teste-lgpd-${suffix}` }).select().single().throwOnError()).data!.id;
    otherOrgId = (await admin.from("organizations").insert({ name: "Org LGPD 2", slug: `org-teste-lgpd2-${suffix}` }).select().single().throwOnError()).data!.id;

    for (const [key, role, org] of [["admin", "admin", orgId], ["vendedor", "agent", orgId], ["intruso", "owner", otherOrgId]] as const) {
      const { data, error } = await admin.auth.admin.createUser({ email: email(key), password, email_confirm: true });
      if (error) throw error;
      users[key] = data.user.id;
      await admin.from("org_members").insert({ org_id: org, user_id: data.user.id, role, accepted_at: new Date().toISOString() }).throwOnError();
    }

    contactId = (await admin.from("contacts").insert({ org_id: orgId, name: "Maria Titular", phone_e164: `+${digits}`, email: `maria-${suffix}@example.com`, opted_in: true }).select().single().throwOnError()).data!.id;
    await admin.from("consents").insert({ org_id: orgId, contact_id: contactId, source: "teste" }).throwOnError();
    const pipeline = (await admin.from("pipelines").insert({ org_id: orgId, name: "Funil" }).select().single().throwOnError()).data!;
    const stage = (await admin.from("pipeline_stages").insert({ org_id: orgId, pipeline_id: pipeline.id, name: "Etapa", position: 1 }).select().single().throwOnError()).data!;
    leadId = (await admin.from("leads").insert({ org_id: orgId, pipeline_id: pipeline.id, stage_id: stage.id, contact_id: contactId, title: "Kwid", value_cents: 9000000, status: "won" }).select().single().throwOnError()).data!.id;
    const channel = (await admin.from("channels").insert({ org_id: orgId, waba_id: `waba-lgpd-${suffix}`, phone_number_id: `pn-lgpd-${suffix}` }).select().single().throwOnError()).data!;
    conversationId = (await admin.from("conversations").insert({ org_id: orgId, contact_id: contactId, channel_id: channel.id }).select().single().throwOnError()).data!.id;
    await admin.from("messages").insert({ org_id: orgId, conversation_id: conversationId, direction: "inbound", type: "text", status: "received", content: { body: "meu CPF é 123" } }).throwOnError();
    await admin.from("webhook_deliveries").insert({ org_id: orgId, payload: { field: "messages", value: { contacts: [{ wa_id: digits }], messages: [{ from: digits, timestamp: "1759070000", text: { body: "meu CPF é 123" } }] } }, signature_valid: true }).throwOnError();
    await admin.from("event_log").insert({ org_id: orgId, type: "whatsapp_inbound_message", payload: { wa_id: digits, text: "meu CPF é 123" }, status: "done" }).throwOnError();
    // Mesmo telefone na OUTRA organização — anonimizar em A não pode tocar nisso.
    await admin.from("webhook_deliveries").insert({ org_id: otherOrgId, payload: { field: "messages", value: { contacts: [{ wa_id: digits }] } }, signature_valid: true }).throwOnError();
    await admin.from("event_log").insert({ org_id: otherOrgId, type: "whatsapp_inbound_message", payload: { wa_id: digits }, status: "done" }).throwOnError();

    // Contatos pra retenção: um velho e parado, outro velho mas com lead em aberto.
    const old = new Date(Date.now() - 800 * 86_400_000).toISOString();
    await admin.from("contacts").insert({ org_id: orgId, name: "Velho Inativo", phone_e164: `+551190000${String(suffix).slice(-4)}`, created_at: old, updated_at: old }).throwOnError();
    const oldActive = (await admin.from("contacts").insert({ org_id: orgId, name: "Velho Com Lead Aberto", phone_e164: `+551180000${String(suffix).slice(-4)}`, created_at: old, updated_at: old }).select().single().throwOnError()).data!;
    await admin.from("leads").insert({ org_id: orgId, pipeline_id: pipeline.id, stage_id: stage.id, contact_id: oldActive.id, title: "Aberto", status: "open" }).throwOnError();
  });

  afterAll(async () => {
    const orgIds = [orgId, otherOrgId].filter(Boolean);
    await admin.from("event_log").delete().in("org_id", orgIds);
    await admin.from("webhook_deliveries").delete().in("org_id", orgIds);
    await admin.from("leads").delete().in("org_id", orgIds);
    await admin.from("organizations").delete().in("id", orgIds);
    for (const id of Object.values(users)) await admin.auth.admin.deleteUser(id);
  });

  it("vendedor não anonimiza", async () => {
    const { error } = await (await as("vendedor")).rpc("fn_anonymize_contact", { p_org_id: orgId, p_contact_id: contactId });
    expect(error?.message).toContain("forbidden");
  });

  it("dono de outra organização não anonimiza contato daqui", async () => {
    const client = await as("intruso");
    const own = await client.rpc("fn_anonymize_contact", { p_org_id: otherOrgId, p_contact_id: contactId });
    expect(own.error?.message).toContain("not_found");
    const foreign = await client.rpc("fn_anonymize_contact", { p_org_id: orgId, p_contact_id: contactId });
    expect(foreign.error?.message).toContain("forbidden");
    const { data } = await admin.from("contacts").select("name").eq("id", contactId).single();
    expect(data!.name).toBe("Maria Titular");
  });

  it("ninguém chama o núcleo nem a varredura direto", async () => {
    const client = await as("admin");
    expect((await client.rpc("fn_anonymize_contact_core", { p_contact_id: contactId })).error).not.toBeNull();
    expect((await client.rpc("fn_retention_sweep", { p_limit: 1 })).error).not.toBeNull();
  });

  it("admin anonimiza: some o que identifica, fica o negócio", async () => {
    const { error } = await (await as("admin")).rpc("fn_anonymize_contact", { p_org_id: orgId, p_contact_id: contactId });
    expect(error).toBeNull();

    const { data: contact } = await admin.from("contacts").select("name, phone_e164, email, opted_in, anonymized_at").eq("id", contactId).single();
    expect(contact).toMatchObject({ name: "Contato anonimizado", email: null, opted_in: false });
    expect(contact!.phone_e164).toBe(`anon-${contactId}`);
    expect(contact!.anonymized_at).not.toBeNull();

    const { data: messages } = await admin.from("messages").select("content").eq("conversation_id", conversationId);
    expect(JSON.stringify(messages)).not.toContain("CPF");

    const { data: consents } = await admin.from("consents").select("revoked_at").eq("contact_id", contactId);
    expect(consents!.every((c) => c.revoked_at !== null)).toBe(true);

    const { data: deliveries } = await admin.from("webhook_deliveries").select("payload").eq("org_id", orgId);
    const { data: events } = await admin.from("event_log").select("payload").eq("org_id", orgId);
    expect(JSON.stringify(deliveries)).not.toContain(digits);
    expect(JSON.stringify(events)).not.toContain(digits);

    const { data: otherDeliveries } = await admin.from("webhook_deliveries").select("payload").eq("org_id", otherOrgId);
    const { data: otherEvents } = await admin.from("event_log").select("payload").eq("org_id", otherOrgId);
    expect(JSON.stringify(otherDeliveries)).toContain(digits);
    expect(JSON.stringify(otherEvents)).toContain(digits);

    const { data: lead } = await admin.from("leads").select("title, value_cents, status, contact_id").eq("id", leadId).single();
    expect(lead).toEqual({ title: "Kwid", value_cents: 9000000, status: "won", contact_id: contactId });
  });

  it("retenção ligada: anonimiza só quem está parado há mais tempo que o prazo", async () => {
    await admin.from("organizations").update({ retention_months: 12 }).eq("id", orgId).throwOnError();
    const { data: swept, error } = await admin.rpc("fn_retention_sweep", { p_limit: 100 });
    expect(error).toBeNull();

    const { data: contacts } = await admin.from("contacts").select("name, anonymized_at").eq("org_id", orgId).order("created_at");
    const byName = new Map(contacts!.map((c) => [c.name, c.anonymized_at]));
    expect(byName.has("Velho Inativo")).toBe(false);
    expect(byName.get("Velho Com Lead Aberto")).toBeNull();
    expect((swept as { org_id: string }[]).filter((r) => r.org_id === orgId)).toHaveLength(1);
  });
});
