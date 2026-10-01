import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { encryptToken, bufferToPgBytea } from "@/lib/crypto/token-cipher";

/**
 * Enviar template de dentro da conversa, contra banco real e com a sessão
 * de verdade do vendedor (RLS valendo). Só a Meta é simulada.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY && process.env.TOKEN_ENCRYPTION_KEY);

const current = vi.hoisted(() => ({
  membership: null as null | { orgId: string; userId: string; role: string; orgName: string; orgSlug: string },
  client: null as unknown,
}));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/require-role", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  requireRole: async () => current.membership,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => current.client }));

const { sendTemplate, sendMessage } = await import("@/lib/actions/messages");

describe.skipIf(!hasCredentials)("enviar template na conversa", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const password = "senha-de-teste-123";
  const users: Record<string, string> = {};
  const sessions: Record<string, SupabaseClient> = {};
  const ids: Record<string, string> = {};
  let orgId: string;
  let otherOrgId: string;
  const metaCalls: { url: string; body: Record<string, unknown> }[] = [];
  const realFetch = globalThis.fetch;

  const as = (key: string) => {
    current.membership = { orgId, userId: users[key], role: "agent", orgName: "Org", orgSlug: "org" };
    current.client = sessions[key];
  };
  const insert = async (table: string, row: Record<string, unknown>) =>
    (await admin.from(table).insert(row).select("*").single().throwOnError()).data as { id: string };

  beforeAll(async () => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith("https://graph.facebook.com/") && url.endsWith("/messages")) {
        metaCalls.push({ url, body: JSON.parse(String(init?.body)) });
        return Response.json({ messages: [{ id: `wamid.tpl-${metaCalls.length}-${suffix}` }] });
      }
      return realFetch(input, init);
    });

    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    orgId = (await insert("organizations", { name: "Org Template", slug: `org-teste-tpl-${suffix}` })).id;
    otherOrgId = (await insert("organizations", { name: "Org Template 2", slug: `org-teste-tpl2-${suffix}` })).id;

    for (const key of ["vendA", "vendB"]) {
      const email = `teste-tpl-${key}-${suffix}@example.com`;
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error) throw error;
      users[key] = data.user.id;
      await admin.from("org_members").insert({ org_id: orgId, user_id: users[key], role: "agent", accepted_at: new Date().toISOString() }).throwOnError();
      const client = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
      const { error: signInError } = await client.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      sessions[key] = client;
    }

    const channel = await insert("channels", {
      org_id: orgId, waba_id: `w-tpl-${suffix}`, phone_number_id: `pn-tpl-${suffix}`, status: "connected",
      access_token_encrypted: bufferToPgBytea(encryptToken("token-falso")),
    });
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 3600_000).toISOString();
    const seq = String(suffix).slice(-6);
    const contact = await insert("contacts", { org_id: orgId, name: "Ana Souza", phone_e164: `+551197${seq}1` });
    // Fora da janela de 24h e sem responsável.
    ids.conv = (await insert("conversations", { org_id: orgId, contact_id: contact.id, channel_id: channel.id, status: "closed", last_inbound_at: twoDaysAgo })).id;
    const contactB = await insert("contacts", { org_id: orgId, name: "Bruno", phone_e164: `+551197${seq}2` });
    ids.convB = (await insert("conversations", {
      org_id: orgId, contact_id: contactB.id, channel_id: channel.id, assigned_to: users.vendB, last_inbound_at: twoDaysAgo,
    })).id;

    ids.withVar = (await insert("message_templates", {
      org_id: orgId, name: `retomada_${seq}`, category: "MARKETING", body_text: "Oi {{1}}, ainda tem interesse no carro?", variable_count: 1, status: "approved",
    })).id;
    ids.noVar = (await insert("message_templates", {
      org_id: orgId, name: `aviso_${seq}`, category: "UTILITY", body_text: "Sua proposta está pronta.", variable_count: 0, status: "approved",
    })).id;
    ids.pending = (await insert("message_templates", {
      org_id: orgId, name: `pendente_${seq}`, category: "UTILITY", body_text: "Ainda em análise.", status: "pending",
    })).id;
    ids.foreign = (await insert("message_templates", {
      org_id: otherOrgId, name: `de_fora_${seq}`, category: "UTILITY", body_text: "De outra loja.", status: "approved",
    })).id;
  }, 60_000);

  afterAll(async () => {
    vi.unstubAllGlobals();
    await admin.from("organizations").delete().in("id", [orgId, otherOrgId].filter(Boolean));
    for (const id of Object.values(users)) await admin.auth.admin.deleteUser(id);
  });

  it("texto livre continua bloqueado fora da janela", async () => {
    as("vendA");
    const fd = new FormData();
    fd.set("conversationId", ids.conv);
    fd.set("body", "oi");
    expect((await sendMessage(null, fd))?.error).toMatch(/janela de 24h/);
    expect(metaCalls).toHaveLength(0);
  });

  it("template aprovado sai fora da janela, com a variável, e entra no histórico", async () => {
    as("vendA");
    expect(await sendTemplate({ conversationId: ids.conv, templateId: ids.withVar, variable: "Ana" })).toBeNull();

    expect(metaCalls).toHaveLength(1);
    const sent = metaCalls[0].body as { to: string; type: string; template: { name: string; language: { code: string }; components: unknown } };
    expect(sent.type).toBe("template");
    expect(sent.template.name).toMatch(/^retomada_/);
    expect(sent.template.language.code).toBe("pt_BR");
    expect(sent.template.components).toEqual([{ type: "body", parameters: [{ type: "text", text: "Ana" }] }]);
    expect(sent.to).not.toContain("+");

    const { data: messages } = await admin.from("messages").select("type, direction, content, sent_by").eq("conversation_id", ids.conv);
    expect(messages).toHaveLength(1);
    expect(messages![0]).toMatchObject({
      type: "template", direction: "outbound", sent_by: users.vendA,
      content: { body: "Oi Ana, ainda tem interesse no carro?" },
    });

    // Conversa livre: enviar já assume.
    const { data: conv } = await admin.from("conversations").select("assigned_to, last_outbound_at").eq("id", ids.conv).single();
    expect(conv!.assigned_to).toBe(users.vendA);
    expect(conv!.last_outbound_at).not.toBeNull();
  });

  it("template sem variável", async () => {
    as("vendA");
    expect(await sendTemplate({ conversationId: ids.conv, templateId: ids.noVar })).toBeNull();
    expect((metaCalls.at(-1)!.body as { template: { components?: unknown } }).template.components).toBeUndefined();
  });

  it("recusa: template não aprovado, de outra organização, variável vazia ou com quebra de linha", async () => {
    as("vendA");
    const before = metaCalls.length;
    expect((await sendTemplate({ conversationId: ids.conv, templateId: ids.pending }))?.error).toMatch(/não aprovado/);
    expect((await sendTemplate({ conversationId: ids.conv, templateId: ids.foreign }))?.error).toMatch(/não aprovado/);
    expect((await sendTemplate({ conversationId: ids.conv, templateId: ids.withVar, variable: "  " }))?.error).toMatch(/variável/);
    expect((await sendTemplate({ conversationId: ids.conv, templateId: ids.withVar, variable: "Ana\nSouza" }))?.error).toMatch(/quebra de linha/);
    expect(metaCalls.length).toBe(before);
  });

  it("não envia em conversa de outro vendedor", async () => {
    as("vendA");
    const before = metaCalls.length;
    expect((await sendTemplate({ conversationId: ids.convB, templateId: ids.noVar }))?.error).toMatch(/outro vendedor/);
    expect(metaCalls.length).toBe(before);
  });
});
