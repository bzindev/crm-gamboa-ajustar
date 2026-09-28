import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * fn_remove_org_member (migration 0022) é SECURITY DEFINER e chamável por
 * qualquer usuário logado via RPC — as regras de quem pode remover quem
 * vivem dentro dela, então precisam ser provadas contra o banco real.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

describe.skipIf(!hasCredentials)("remover membro da organização", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const password = "senha-de-teste-123";
  const users: Record<string, string> = {};
  let orgId: string;
  let otherOrgId: string;
  let openLeadId: string;
  let wonLeadId: string;
  let conversationId: string;
  let teamId: string;

  const email = (key: string) => `teste-remover-${key}-${suffix}@example.com`;

  // Uma sessão por usuário, reaproveitada (limite de logins do Supabase).
  const sessions = new Map<string, Promise<SupabaseClient>>();
  function signIn(key: string) {
    if (!sessions.has(key)) {
      sessions.set(key, (async () => {
        const client = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, {
          auth: { autoRefreshToken: false, persistSession: false },
        });
        const { error } = await client.auth.signInWithPassword({ email: email(key), password });
        if (error) throw error;
        return client;
      })());
    }
    return sessions.get(key)!;
  }

  async function remove(asKey: string, targetKey: string, org = orgId) {
    const client = await signIn(asKey);
    return client.rpc("fn_remove_org_member", { p_org_id: org, p_user_id: users[targetKey] });
  }

  async function isMember(key: string) {
    const { data } = await admin.from("org_members").select("user_id").eq("org_id", orgId).eq("user_id", users[key]);
    return (data ?? []).length > 0;
  }

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: org } = await admin.from("organizations").insert({ name: "Org Remover", slug: `org-teste-rm-${suffix}` }).select().single().throwOnError();
    orgId = org!.id;
    const { data: other } = await admin.from("organizations").insert({ name: "Org Outra", slug: `org-teste-rm2-${suffix}` }).select().single().throwOnError();
    otherOrgId = other!.id;

    const roles: [string, string, string][] = [
      ["dono", "owner", orgId],
      ["admin", "admin", orgId],
      ["admin2", "admin", orgId],
      ["vendedor", "agent", orgId],
      ["vendedor2", "agent", orgId],
      ["intruso", "owner", otherOrgId],
    ];
    for (const [key, role, org] of roles) {
      const { data, error } = await admin.auth.admin.createUser({ email: email(key), password, email_confirm: true });
      if (error) throw error;
      users[key] = data.user.id;
      await admin.from("org_members").insert({ org_id: org, user_id: data.user.id, role, accepted_at: new Date().toISOString() }).throwOnError();
    }

    const { data: pipeline } = await admin.from("pipelines").insert({ org_id: orgId, name: "Funil" }).select().single().throwOnError();
    const { data: stage } = await admin.from("pipeline_stages").insert({ org_id: orgId, pipeline_id: pipeline!.id, name: "Etapa", position: 1 }).select().single().throwOnError();
    const { data: contact } = await admin.from("contacts").insert({ org_id: orgId, phone_e164: `+55118${String(suffix).slice(-8)}` }).select().single().throwOnError();
    const lead = (status: string) => ({
      org_id: orgId, pipeline_id: pipeline!.id, stage_id: stage!.id, contact_id: contact!.id,
      title: `Lead ${status}`, owner_id: users.vendedor, status,
    });
    openLeadId = (await admin.from("leads").insert(lead("open")).select().single().throwOnError()).data!.id;
    wonLeadId = (await admin.from("leads").insert(lead("won")).select().single().throwOnError()).data!.id;

    const { data: channel } = await admin.from("channels").insert({ org_id: orgId, waba_id: `waba-rm-${suffix}`, phone_number_id: `pn-rm-${suffix}` }).select().single().throwOnError();
    conversationId = (await admin.from("conversations").insert({
      org_id: orgId, contact_id: contact!.id, channel_id: channel!.id,
      assigned_to: users.vendedor, assigned_at: new Date().toISOString(),
    }).select().single().throwOnError()).data!.id;

    teamId = (await admin.from("teams").insert({ org_id: orgId, name: "Setor", last_assigned_member_id: users.vendedor }).select().single().throwOnError()).data!.id;
    await admin.from("team_members").insert({ org_id: orgId, team_id: teamId, user_id: users.vendedor }).throwOnError();
  });

  afterAll(async () => {
    const orgIds = [orgId, otherOrgId].filter(Boolean);
    await admin.from("leads").delete().in("org_id", orgIds);
    await admin.from("organizations").delete().in("id", orgIds);
    for (const id of Object.values(users)) await admin.auth.admin.deleteUser(id);
  });

  it("vendedor não remove ninguém", async () => {
    const { error } = await remove("vendedor2", "vendedor");
    expect(error?.message).toContain("forbidden");
    expect(await isMember("vendedor")).toBe(true);
  });

  it("dono de OUTRA organização não remove membro desta", async () => {
    const { error } = await remove("intruso", "vendedor");
    expect(error?.message).toContain("forbidden");
    expect(await isMember("vendedor")).toBe(true);
  });

  it("ninguém remove a si mesmo", async () => {
    const { error } = await remove("admin", "admin");
    expect(error?.message).toContain("cannot_remove_self");
    expect(await isMember("admin")).toBe(true);
  });

  it("admin não remove o dono", async () => {
    const { error } = await remove("admin", "dono");
    expect(error?.message).toContain("cannot_remove_owner");
    expect(await isMember("dono")).toBe(true);
  });

  it("admin não remove outro admin", async () => {
    const { error } = await remove("admin", "admin2");
    expect(error?.message).toContain("forbidden");
    expect(await isMember("admin2")).toBe(true);
  });

  it("admin remove vendedor: trabalho em aberto volta pra fila, histórico fica", async () => {
    const { data, error } = await remove("admin", "vendedor");
    expect(error).toBeNull();
    expect(data).toBe("agent");
    expect(await isMember("vendedor")).toBe(false);

    const { data: openLead } = await admin.from("leads").select("owner_id").eq("id", openLeadId).single();
    const { data: wonLead } = await admin.from("leads").select("owner_id").eq("id", wonLeadId).single();
    const { data: conversation } = await admin.from("conversations").select("assigned_to, assigned_at").eq("id", conversationId).single();
    const { data: teamRows } = await admin.from("team_members").select("user_id").eq("team_id", teamId);
    const { data: team } = await admin.from("teams").select("last_assigned_member_id").eq("id", teamId).single();

    expect(openLead!.owner_id).toBeNull();
    expect(wonLead!.owner_id).toBe(users.vendedor);
    expect(conversation).toEqual({ assigned_to: null, assigned_at: null });
    expect(teamRows).toEqual([]);
    expect(team!.last_assigned_member_id).toBeNull();
  });

  it("quem foi removido perde o acesso na hora (mesmo com o login ainda válido)", async () => {
    const client = await signIn("vendedor");
    const { data } = await client.from("leads").select("id").eq("org_id", orgId);
    expect(data).toEqual([]);
  });

  it("dono remove admin", async () => {
    const { error } = await remove("dono", "admin2");
    expect(error).toBeNull();
    expect(await isMember("admin2")).toBe(false);
  });
});
