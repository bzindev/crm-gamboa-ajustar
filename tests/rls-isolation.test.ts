import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

/**
 * Gate obrigatório da Fase 1 (ver BRIEFING.md e PLANO.md): prova que um
 * usuário de uma organização não lê NADA de outra organização, mesmo tendo
 * um JWT válido e de verdade (não simulado). Roda contra o projeto Supabase
 * real configurado em .env.local — sem essas variáveis, a suíte é pulada
 * (não falha, porque nem todo mundo vai ter o projeto configurado o tempo
 * todo, mas fica claro no relatório do Vitest que foi pulada, não que
 * passou).
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

describe.skipIf(!hasCredentials)("isolamento entre organizações (RLS)", () => {
  // Criado dentro de beforeAll (não aqui no corpo do describe): o corpo do
  // describe roda sempre, mesmo com skipIf, só para registrar os testes —
  // criar o client aqui derrubaria a suíte inteira quando as credenciais
  // não existem, em vez de pulá-la de verdade.
  let admin: SupabaseClient;

  const suffix = Date.now();
  const userAEmail = `teste-isolamento-a-${suffix}@example.com`;
  const userBEmail = `teste-isolamento-b-${suffix}@example.com`;
  const password = "senha-de-teste-123";

  let orgAId: string;
  let orgBId: string;
  let userAId: string;
  let userBId: string;

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: orgA, error: orgAError } = await admin
      .from("organizations")
      .insert({ name: "Org Teste A", slug: `org-teste-a-${suffix}` })
      .select()
      .single();
    if (orgAError) throw orgAError;
    orgAId = orgA.id;

    const { data: orgB, error: orgBError } = await admin
      .from("organizations")
      .insert({ name: "Org Teste B", slug: `org-teste-b-${suffix}` })
      .select()
      .single();
    if (orgBError) throw orgBError;
    orgBId = orgB.id;

    const { data: userA, error: userAError } = await admin.auth.admin.createUser({
      email: userAEmail,
      password,
      email_confirm: true,
    });
    if (userAError) throw userAError;
    userAId = userA.user.id;

    const { data: userB, error: userBError } = await admin.auth.admin.createUser({
      email: userBEmail,
      password,
      email_confirm: true,
    });
    if (userBError) throw userBError;
    userBId = userB.user.id;

    const { error: memberAError } = await admin.from("org_members").insert({
      org_id: orgAId,
      user_id: userAId,
      role: "owner",
      accepted_at: new Date().toISOString(),
    });
    if (memberAError) throw memberAError;

    const { error: memberBError } = await admin.from("org_members").insert({
      org_id: orgBId,
      user_id: userBId,
      role: "owner",
      accepted_at: new Date().toISOString(),
    });
    if (memberBError) throw memberBError;

    await seedOneRowPerTenantTable(orgBId, userBId);
  });

  // Uma linha em CADA tabela com org_id, dentro da organização B — sem
  // isso, "A lê zero linhas de B" passaria por tabela vazia, não por RLS.
  async function seedOneRowPerTenantTable(orgId: string, userId: string) {
    const insert = async (table: string, row: Record<string, unknown>) => {
      const { data, error } = await admin.from(table).insert(row).select("*").single();
      if (error) throw new Error(`seed ${table}: ${error.message}`);
      return data as Record<string, unknown> & { id: string };
    };

    const pipeline = await insert("pipelines", { org_id: orgId, name: "Funil B" });
    const stage = await insert("pipeline_stages", {
      org_id: orgId, pipeline_id: pipeline.id, name: "Etapa B", position: 1,
    });
    const contact = await insert("contacts", { org_id: orgId, phone_e164: `+55119${String(suffix).slice(-8)}` });
    const lead = await insert("leads", {
      org_id: orgId, pipeline_id: pipeline.id, stage_id: stage.id, contact_id: contact.id, title: "Lead B",
    });
    const tag = await insert("tags", { org_id: orgId, name: "Tag B" });
    await admin.from("lead_tags").insert({ org_id: orgId, lead_id: lead.id, tag_id: tag.id }).throwOnError();
    const team = await insert("teams", { org_id: orgId, name: "Setor B" });
    await admin.from("team_members").insert({ org_id: orgId, team_id: team.id, user_id: userId }).throwOnError();
    const channel = await insert("channels", {
      org_id: orgId, waba_id: `waba-${suffix}`, phone_number_id: `pn-${suffix}`,
    });
    const conversation = await insert("conversations", {
      org_id: orgId, contact_id: contact.id, channel_id: channel.id,
    });
    await admin.from("conversation_tags").insert({ org_id: orgId, conversation_id: conversation.id, tag_id: tag.id }).throwOnError();
    await insert("messages", {
      org_id: orgId, conversation_id: conversation.id, direction: "inbound", type: "text", status: "received",
    });
    await insert("consents", { org_id: orgId, contact_id: contact.id, source: "teste" });
    await insert("notifications", { org_id: orgId, user_id: userId, type: "teste", title: "Notificação B" });
    await insert("audit_log", { org_id: orgId, action: "teste", resource_type: "teste" });
    await insert("event_log", { org_id: orgId, type: "teste", payload: {} });
    await insert("org_invites", {
      org_id: orgId, email: `convite-${suffix}@example.com`, role: "agent", token: `token-${suffix}`,
    });
    await insert("webhook_deliveries", { org_id: orgId, payload: {}, signature_valid: true });
    const template = await insert("message_templates", {
      org_id: orgId, name: `tpl_${suffix}`, category: "UTILITY", body_text: "Olá",
    });
    const campaign = await insert("bulk_campaigns", { org_id: orgId, name: "Campanha B", template_id: template.id });
    await insert("bulk_campaign_recipients", { org_id: orgId, campaign_id: campaign.id, contact_id: contact.id });
  }

  afterAll(async () => {
    // Quase tudo cai em cascata ao apagar a organização; leads→etapa e
    // campanha→template são RESTRICT, então esses saem antes.
    const orgIds = [orgAId, orgBId].filter(Boolean);
    // event_log/webhook_deliveries não caem em cascata (org_id vira null) —
    // sem apagar antes, ficavam como lixo órfão na fila real.
    await admin.from("event_log").delete().in("org_id", orgIds);
    await admin.from("webhook_deliveries").delete().in("org_id", orgIds);
    await admin.from("leads").delete().in("org_id", orgIds);
    await admin.from("bulk_campaigns").delete().in("org_id", orgIds);
    await admin.from("organizations").delete().in("id", orgIds);
    await admin.auth.admin.deleteUser(userAId);
    await admin.auth.admin.deleteUser(userBId);
  });

  it("caso de controle: a organização e o membro de B existem de verdade", async () => {
    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .eq("id", orgBId)
      .single();
    expect(orgError).toBeNull();
    expect(org?.id).toBe(orgBId);

    const { data: members, error: membersError } = await admin
      .from("org_members")
      .select("id")
      .eq("org_id", orgBId);
    expect(membersError).toBeNull();
    expect(members?.length).toBeGreaterThan(0);
  });

  it("usuário de A não lê nenhuma linha de B com um JWT real", async () => {
    const asUserA = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: signInError } = await asUserA.auth.signInWithPassword({
      email: userAEmail,
      password,
    });
    expect(signInError).toBeNull();

    const { data: orgs, error: orgsError } = await asUserA
      .from("organizations")
      .select("id")
      .eq("id", orgBId);
    expect(orgsError).toBeNull();
    expect(orgs).toEqual([]);

    const { data: members, error: membersError } = await asUserA
      .from("org_members")
      .select("id")
      .eq("org_id", orgBId);
    expect(membersError).toBeNull();
    expect(members).toEqual([]);

    // Controle positivo simétrico: o mesmo usuário DEVE ver a própria
    // organização — se isso falhasse, o teste acima passaria por engano
    // (RLS bloqueando tudo, não só o que devia).
    const { data: ownOrg, error: ownOrgError } = await asUserA
      .from("organizations")
      .select("id")
      .eq("id", orgAId);
    expect(ownOrgError).toBeNull();
    expect(ownOrg).toEqual([{ id: orgAId }]);
  });

  const TENANT_TABLES = [
    "audit_log", "bulk_campaign_recipients", "bulk_campaigns", "channels", "consents", "contacts", "conversation_tags",
    "conversations", "event_log", "lead_tags", "leads", "message_templates", "messages",
    "notifications", "org_invites", "pipeline_stages", "pipelines", "tags", "team_members",
    "teams", "webhook_deliveries",
  ];

  // Um login só, reaproveitado — o Supabase limita logins por minuto, e
  // logar de novo pra cada tabela estourava o limite na suíte completa.
  let sessionA: Promise<SupabaseClient> | null = null;
  function signInAsA() {
    sessionA ??= (async () => {
      const client = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { error } = await client.auth.signInWithPassword({ email: userAEmail, password });
      if (error) throw error;
      return client;
    })();
    return sessionA;
  }

  it.each(TENANT_TABLES)("controle: B tem linha de verdade em %s", async (table) => {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("org_id", orgBId);
    expect(error).toBeNull();
    expect(count).toBeGreaterThan(0);
  });

  it.each(TENANT_TABLES)("usuário de A não lê nenhuma linha de B em %s", async (table) => {
    const asUserA = await signInAsA();
    const { data, error } = await asUserA.from(table).select("*").eq("org_id", orgBId);
    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("usuário de A não consegue criar, alterar nem apagar dado de B", async () => {
    const asUserA = await signInAsA();

    const { error: insertError } = await asUserA
      .from("contacts")
      .insert({ org_id: orgBId, phone_e164: "+5511900000001" });
    expect(insertError).not.toBeNull();

    const { data: target } = await admin.from("contacts").select("id, name").eq("org_id", orgBId).limit(1).single();

    const { data: updated } = await asUserA
      .from("contacts")
      .update({ name: "invadido" })
      .eq("id", target!.id)
      .select("id");
    expect(updated ?? []).toEqual([]);

    const { data: deleted } = await asUserA.from("contacts").delete().eq("id", target!.id).select("id");
    expect(deleted ?? []).toEqual([]);

    const { data: after } = await admin.from("contacts").select("id, name").eq("id", target!.id).single();
    expect(after).toEqual(target);
  });
});
