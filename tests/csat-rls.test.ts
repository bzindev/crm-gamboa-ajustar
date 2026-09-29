import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Migration 0028: nota de CSAT é do cliente — membro só lê; a pesquisa é
 * criada pela função fn_queue_csat_survey, que confere a própria conversa.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

describe.skipIf(!hasCredentials)("CSAT: quem pode gravar nota", () => {
  let admin: SupabaseClient;
  let member: SupabaseClient;
  const suffix = Date.now();
  const email = `teste-csatrls-${suffix}@example.com`;
  const password = "senha-de-teste-123";
  let userId: string;
  let orgId: string;
  let contactId: string;
  let resolvedId: string;
  let openId: string;

  const count = async (conversationId: string) =>
    (await admin.from("csat_surveys").select("*", { count: "exact", head: true }).eq("conversation_id", conversationId)).count;

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    userId = (await admin.auth.admin.createUser({ email, password, email_confirm: true })).data.user!.id;
    orgId = (await admin.from("organizations").insert({ name: "Org CSAT RLS", slug: `org-teste-csatrls-${suffix}`, csat_enabled: true }).select().single().throwOnError()).data!.id;
    await admin.from("org_members").insert({ org_id: orgId, user_id: userId, role: "agent", accepted_at: new Date().toISOString() }).throwOnError();
    const channel = (await admin.from("channels").insert({ org_id: orgId, waba_id: `w-${suffix}`, phone_number_id: `pn-${suffix}` }).select().single().throwOnError()).data!;
    contactId = (await admin.from("contacts").insert({ org_id: orgId, phone_e164: `+55119444${String(suffix).slice(-5)}` }).select().single().throwOnError()).data!.id;
    resolvedId = (await admin.from("conversations").insert({ org_id: orgId, contact_id: contactId, channel_id: channel.id, status: "resolved", assigned_to: userId }).select().single().throwOnError()).data!.id;
    const other = (await admin.from("contacts").insert({ org_id: orgId, phone_e164: `+55119333${String(suffix).slice(-5)}` }).select().single().throwOnError()).data!;
    openId = (await admin.from("conversations").insert({ org_id: orgId, contact_id: other.id, channel_id: channel.id, status: "open" }).select().single().throwOnError()).data!.id;

    member = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await member.auth.signInWithPassword({ email, password });
    if (error) throw error;
  });

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("membro não cria nota direto (nem pra si mesmo)", async () => {
    const { error } = await member.from("csat_surveys").insert({
      org_id: orgId, conversation_id: resolvedId, contact_id: contactId, agent_id: userId, status: "answered", rating: 5,
    });
    expect(error).not.toBeNull();
    expect(await count(resolvedId)).toBe(0);
  });

  it("a função cria a pesquisa pendente pra conversa resolvida, uma vez só", async () => {
    expect((await member.rpc("fn_queue_csat_survey", { p_conversation_id: resolvedId })).error).toBeNull();
    expect((await member.rpc("fn_queue_csat_survey", { p_conversation_id: resolvedId })).error).toBeNull();
    const { data } = await admin.from("csat_surveys").select("status, agent_id, rating").eq("conversation_id", resolvedId);
    // O cron (se estiver rodando) pode já ter processado e mudado o status
    // pra "skipped" — o que importa aqui: uma só, do vendedor certo, sem nota.
    expect(data).toHaveLength(1);
    expect(data![0]).toMatchObject({ agent_id: userId, rating: null });
    expect(["pending", "skipped", "failed"]).toContain(data![0].status);
  });

  it("membro não altera a nota depois", async () => {
    const { data } = await member.from("csat_surveys").update({ status: "answered", rating: 5 }).eq("conversation_id", resolvedId).select("id");
    expect(data ?? []).toEqual([]);
    const { data: after } = await admin.from("csat_surveys").select("status, rating").eq("conversation_id", resolvedId).single();
    expect(after!.rating).toBeNull();
    expect(after!.status).not.toBe("answered");
  });

  it("conversa que não está resolvida não gera pesquisa", async () => {
    await member.rpc("fn_queue_csat_survey", { p_conversation_id: openId });
    expect(await count(openId)).toBe(0);
  });
});
