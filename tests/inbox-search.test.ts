import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_FILTERS, filtersToSearchParams, parseInboxFilters, type InboxFilters } from "@/lib/inbox/filters";
import { searchConversations } from "@/lib/inbox/search";

/**
 * Filtros da Inbox contra o banco real (fn_search_conversations, migration
 * 0031), com sessões de verdade — a RLS e a regra do vendedor comum valem
 * como em produção. "Agora" é fixado em 15/09/2026 12:00 de Brasília.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

const NOW = new Date("2026-09-15T15:00:00Z");
const brt = (local: string) => new Date(`${local}-03:00`).toISOString();

describe.skipIf(!hasCredentials)("busca de conversas com filtros (banco real)", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const password = "senha-de-teste-123";
  const email = (k: string) => `teste-inbox-${k}-${suffix}@example.com`;
  const users: Record<string, string> = {};
  const sessions: Record<string, SupabaseClient> = {};
  let orgId: string;
  let otherOrgId: string;
  const ids: Record<string, string> = {};

  const insert = async (table: string, row: Record<string, unknown>) => {
    const { data, error } = await admin.from(table).insert(row).select("*").single();
    if (error) throw new Error(`seed ${table}: ${error.message}`);
    return data as Record<string, unknown> & { id: string };
  };

  /** Busca como `who` e devolve os nomes dos contatos, em ordem alfabética. */
  const names = async (who: string, patch: Partial<InboxFilters> = {}, org = orgId) => {
    const result = await searchConversations(
      sessions[who],
      { orgId: org, userId: users[who] },
      { ...DEFAULT_FILTERS, ...patch },
      { offset: 0, limit: 50 },
      NOW,
    );
    return result.items.map((c) => c.contactName).sort();
  };

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    orgId = (await insert("organizations", { name: "Org Inbox", slug: `org-teste-inbox-${suffix}` })).id;
    otherOrgId = (await insert("organizations", { name: "Org Inbox 2", slug: `org-teste-inbox2-${suffix}` })).id;

    for (const [key, role] of [["gestor", "manager"], ["vendA", "agent"], ["vendB", "agent"]] as const) {
      const { data, error } = await admin.auth.admin.createUser({ email: email(key), password, email_confirm: true, user_metadata: { full_name: key } });
      if (error) throw error;
      users[key] = data.user.id;
      await admin.from("org_members").insert({ org_id: orgId, user_id: users[key], role, accepted_at: new Date().toISOString() }).throwOnError();
      const client = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
      const { error: signInError } = await client.auth.signInWithPassword({ email: email(key), password });
      if (signInError) throw signInError;
      sessions[key] = client;
    }

    const channel = await insert("channels", { org_id: orgId, waba_id: `waba-inbox-${suffix}`, phone_number_id: `pn-inbox-${suffix}` });
    const pipeline = await insert("pipelines", { org_id: orgId, name: "Funil" });
    ids.stage1 = (await insert("pipeline_stages", { org_id: orgId, pipeline_id: pipeline.id, name: "Novo", position: 1 })).id;
    ids.stage2 = (await insert("pipeline_stages", { org_id: orgId, pipeline_id: pipeline.id, name: "Proposta", position: 2 })).id;
    ids.team = (await insert("teams", { org_id: orgId, name: `Seminovos ${suffix}` })).id;
    ids.vip = (await insert("tags", { org_id: orgId, name: `VIP ${suffix}` })).id;
    ids.fin = (await insert("tags", { org_id: orgId, name: `Financiamento ${suffix}` })).id;

    const seq = String(suffix).slice(-6);
    const conversation = async (
      key: string,
      name: string,
      phone: string,
      row: Record<string, unknown>,
      tags: string[] = [],
      stage?: string,
    ) => {
      const contact = await insert("contacts", { org_id: orgId, name, phone_e164: phone });
      const conv = await insert("conversations", { org_id: orgId, contact_id: contact.id, channel_id: channel.id, ...row });
      ids[key] = conv.id;
      for (const tag of tags) {
        await admin.from("conversation_tags").insert({ org_id: orgId, conversation_id: conv.id, tag_id: tag }).throwOnError();
      }
      if (stage) {
        await insert("leads", { org_id: orgId, pipeline_id: pipeline.id, stage_id: stage, contact_id: contact.id, title: name });
      }
    };

    // Ana: do vendedor A, quente, VIP + Financiamento, criada no 1º segundo de hoje, cliente esperando.
    await conversation("ana", "Ana Souza", `+551191${seq}1`, {
      status: "open", temperature: "hot", assigned_to: users.vendA,
      created_at: brt("2026-09-15T00:00:00"), last_inbound_at: brt("2026-09-15T10:00:00"),
    }, [ids.vip, ids.fin], ids.stage1);
    // Bruno: do vendedor B, morno, VIP, criado no último segundo de ontem, já respondido e lido.
    await conversation("bruno", "Bruno Lima", `+551192${seq}2`, {
      status: "pending", temperature: "warm", assigned_to: users.vendB,
      created_at: brt("2026-09-14T23:59:59"), last_inbound_at: brt("2026-09-14T11:00:00"),
      last_outbound_at: brt("2026-09-14T12:00:00"), last_read_at: brt("2026-09-14T11:30:00"),
    }, [ids.vip]);
    // Carla: na fila (sem responsável), sem temperatura, resolvida em 10/09, setor Seminovos.
    await conversation("carla", "Carla Dias", `+551193${seq}3`, {
      status: "resolved", team_id: ids.team, created_at: brt("2026-09-01T09:00:00"),
    });
    // Daniel: do gestor, frio, Financiamento, fechada em agosto, lead na etapa Proposta.
    await conversation("daniel", "Daniel Rocha", `+552194${seq}4`, {
      status: "closed", temperature: "cold", assigned_to: users.gestor, created_at: brt("2026-08-20T09:00:00"),
    }, [ids.fin], ids.stage2);

    // A trigger grava resolved_at = agora ao inserir encerrada; fixa datas conhecidas.
    await admin.from("conversations").update({ resolved_at: brt("2026-09-10T12:00:00") }).eq("id", ids.carla).throwOnError();
    await admin.from("conversations").update({ resolved_at: brt("2026-08-25T12:00:00") }).eq("id", ids.daniel).throwOnError();

    await insert("messages", {
      org_id: orgId, conversation_id: ids.ana, direction: "inbound", type: "text", status: "received", content: { body: "Oi, tem o Kwid?" },
    });

    // Outra organização, com conversa que bateria em qualquer filtro.
    const otherChannel = await insert("channels", { org_id: otherOrgId, waba_id: `waba-inbox2-${suffix}`, phone_number_id: `pn-inbox2-${suffix}` });
    const otherContact = await insert("contacts", { org_id: otherOrgId, name: "Ana Souza", phone_e164: `+551195${seq}5` });
    await insert("conversations", { org_id: otherOrgId, contact_id: otherContact.id, channel_id: otherChannel.id });
  }, 60_000);

  afterAll(async () => {
    await admin.from("organizations").delete().in("id", [orgId, otherOrgId].filter(Boolean));
    for (const id of Object.values(users)) await admin.auth.admin.deleteUser(id);
  });

  it("sem filtro: todas da organização, com total, contagem por status e prévia", async () => {
    const result = await searchConversations(sessions.gestor, { orgId, userId: users.gestor }, DEFAULT_FILTERS, { offset: 0, limit: 50 }, NOW);
    expect(result.total).toBe(4);
    expect(result.byStatus).toEqual({ open: 1, pending: 1, resolved: 1, closed: 1 });
    // Mais recente primeiro (última mensagem; sem mensagem, a criação).
    expect(result.items.map((c) => c.contactName)).toEqual(["Ana Souza", "Bruno Lima", "Carla Dias", "Daniel Rocha"]);
    const ana = result.items[0];
    expect(ana.lastMessagePreview).toBe("Oi, tem o Kwid?");
    expect(ana.tags.map((t) => t.id).sort()).toEqual([ids.vip, ids.fin].sort());
    expect(ana.assignedToName).toBe("vendA");
  });

  it("status", async () => {
    expect(await names("gestor", { status: "open" })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { status: "closed" })).toEqual(["Daniel Rocha"]);
  });

  it("status não mexe na contagem das abas (os outros filtros sim)", async () => {
    const result = await searchConversations(
      sessions.gestor, { orgId, userId: users.gestor },
      { ...DEFAULT_FILTERS, status: "open", tagIds: [ids.vip] }, { offset: 0, limit: 50 }, NOW,
    );
    expect(result.total).toBe(1);
    expect(result.byStatus).toEqual({ open: 1, pending: 1 });
  });

  it("temperatura: várias ao mesmo tempo e 'sem temperatura'", async () => {
    expect(await names("gestor", { temperatures: ["hot", "warm"] })).toEqual(["Ana Souza", "Bruno Lima"]);
    expect(await names("gestor", { temperatures: ["none"] })).toEqual(["Carla Dias"]);
    expect(await names("gestor", { temperatures: ["cold", "none"] })).toEqual(["Carla Dias", "Daniel Rocha"]);
  });

  it("etiquetas: OU (qualquer uma) vs E (todas)", async () => {
    expect(await names("gestor", { tagIds: [ids.vip, ids.fin], tagMode: "any" })).toEqual(["Ana Souza", "Bruno Lima", "Daniel Rocha"]);
    expect(await names("gestor", { tagIds: [ids.vip, ids.fin], tagMode: "all" })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { tagIds: [ids.fin], tagMode: "all" })).toEqual(["Ana Souza", "Daniel Rocha"]);
  });

  it("vendedor: por pessoa, 'comigo', 'sem responsável' e combinados", async () => {
    expect(await names("gestor", { vendors: [users.vendA] })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { vendors: ["me"] })).toEqual(["Daniel Rocha"]);
    expect(await names("gestor", { vendors: ["none"] })).toEqual(["Carla Dias"]);
    expect(await names("gestor", { vendors: [users.vendB, "none"] })).toEqual(["Bruno Lima", "Carla Dias"]);
  });

  it("período nos limites do dia: 00:00:00 é hoje, 23:59:59 de ontem é ontem", async () => {
    expect(await names("gestor", { dateField: "created", period: "today" })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { dateField: "created", period: "yesterday" })).toEqual(["Bruno Lima"]);
    expect(await names("gestor", { dateField: "created", period: "custom", from: "2026-09-14", to: "2026-09-14" })).toEqual(["Bruno Lima"]);
    expect(await names("gestor", { dateField: "created", period: "custom", from: "2026-09-15", to: null })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { dateField: "created", period: "last_month" })).toEqual(["Daniel Rocha"]);
  });

  it("período pela última mensagem e pela data de resolução", async () => {
    expect(await names("gestor", { period: "today" })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { period: "7d" })).toEqual(["Ana Souza", "Bruno Lima"]);
    expect(await names("gestor", { dateField: "resolved", period: "this_month" })).toEqual(["Carla Dias"]);
    expect(await names("gestor", { dateField: "resolved", period: "last_month" })).toEqual(["Daniel Rocha"]);
  });

  it("não lidas e aguardando resposta", async () => {
    expect(await names("gestor", { unread: true })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { awaiting: true })).toEqual(["Ana Souza"]);
  });

  it("busca por nome (sem diferenciar maiúscula) e por telefone", async () => {
    expect(await names("gestor", { q: "souza" })).toEqual(["Ana Souza"]);
    const bruno = (await searchConversations(sessions.gestor, { orgId, userId: users.gestor }, { ...DEFAULT_FILTERS, q: "Bruno" }, { offset: 0, limit: 5 }, NOW)).items[0];
    expect(await names("gestor", { q: bruno.contactPhone.slice(-6) })).toEqual(["Bruno Lima"]);
    // % e _ digitados valem como texto, não como curinga.
    expect(await names("gestor", { q: "%" })).toEqual([]);
    expect(await names("gestor", { q: "_" })).toEqual([]);
  });

  it("etapa do funil (pelo lead do contato) e setor", async () => {
    expect(await names("gestor", { stageIds: [ids.stage2] })).toEqual(["Daniel Rocha"]);
    expect(await names("gestor", { stageIds: [ids.stage1, ids.stage2] })).toEqual(["Ana Souza", "Daniel Rocha"]);
    expect(await names("gestor", { teamIds: [ids.team] })).toEqual(["Carla Dias"]);
  });

  it("vários filtros juntos valem ao mesmo tempo (E entre categorias)", async () => {
    expect(await names("gestor", { vendors: [users.vendA], temperatures: ["hot"], period: "today" })).toEqual(["Ana Souza"]);
    expect(await names("gestor", { vendors: [users.vendB], temperatures: ["hot"] })).toEqual([]);
    expect(await names("gestor", { tagIds: [ids.vip], temperatures: ["warm", "hot"], status: "pending", period: "7d" })).toEqual(["Bruno Lima"]);
  });

  it("vendedor comum vê só as dele + a fila, mesmo pedindo outro vendedor pela URL", async () => {
    expect(await names("vendA")).toEqual(["Ana Souza", "Carla Dias"]);
    expect(await names("vendA", { vendors: [users.vendB] })).toEqual([]);
    expect(await names("vendA", { vendors: [users.gestor, users.vendB] })).toEqual([]);
    expect(await names("vendA", { tagIds: [ids.vip] })).toEqual(["Ana Souza"]);
    expect(await names("vendB")).toEqual(["Bruno Lima", "Carla Dias"]);
    const counts = await searchConversations(sessions.vendA, { orgId, userId: users.vendA }, DEFAULT_FILTERS, { offset: 0, limit: 50 }, NOW);
    expect(counts.total).toBe(2);
    expect(counts.byStatus).toEqual({ open: 1, resolved: 1 });
  });

  it("organização de fora (id trocado na mão) devolve vazio", async () => {
    expect(await names("gestor", {}, otherOrgId)).toEqual([]);
  });

  it("filtro sem resultado: total 0 e lista vazia", async () => {
    const result = await searchConversations(sessions.gestor, { orgId, userId: users.gestor }, { ...DEFAULT_FILTERS, q: "ninguém com esse nome" }, { offset: 0, limit: 50 }, NOW);
    expect(result).toEqual({ items: [], total: 0, byStatus: {}, hasMore: false });
  });

  it("paginação: páginas não se repetem e hasMore avisa que tem mais", async () => {
    const viewer = { orgId, userId: users.gestor };
    const first = await searchConversations(sessions.gestor, viewer, DEFAULT_FILTERS, { offset: 0, limit: 3 }, NOW);
    const second = await searchConversations(sessions.gestor, viewer, DEFAULT_FILTERS, { offset: 3, limit: 3 }, NOW);
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    expect(second.items.map((c) => c.contactName)).toEqual(["Daniel Rocha"]);
    expect(second.hasMore).toBe(false);
  });

  it("link com filtros, recarregado, devolve o mesmo resultado", async () => {
    const filters: InboxFilters = { ...DEFAULT_FILTERS, tagIds: [ids.vip, ids.fin], tagMode: "any", temperatures: ["hot", "warm"], period: "7d" };
    const url = filtersToSearchParams(filters).toString();
    const reloaded = parseInboxFilters(new URLSearchParams(url));
    expect(reloaded).toEqual(filters);
    expect(await names("gestor", reloaded)).toEqual(await names("gestor", filters));
    expect(await names("gestor", reloaded)).toEqual(["Ana Souza", "Bruno Lima"]);
  });

  it("resolved_at acompanha o status (resolver grava, reabrir limpa)", async () => {
    await admin.from("conversations").update({ status: "resolved" }).eq("id", ids.bruno).throwOnError();
    const { data: resolved } = await admin.from("conversations").select("resolved_at").eq("id", ids.bruno).single();
    expect(resolved!.resolved_at).not.toBeNull();
    await admin.from("conversations").update({ status: "closed" }).eq("id", ids.bruno).throwOnError();
    const { data: closed } = await admin.from("conversations").select("resolved_at").eq("id", ids.bruno).single();
    expect(closed!.resolved_at).toBe(resolved!.resolved_at);
    await admin.from("conversations").update({ status: "pending" }).eq("id", ids.bruno).throwOnError();
    const { data: reopened } = await admin.from("conversations").select("resolved_at").eq("id", ids.bruno).single();
    expect(reopened!.resolved_at).toBeNull();
  });
});
