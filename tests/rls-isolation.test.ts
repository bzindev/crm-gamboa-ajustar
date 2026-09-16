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
  });

  afterAll(async () => {
    // organizations tem "on delete cascade" para org_members — apagar a
    // organização já limpa a membresia junto.
    await admin.from("organizations").delete().in("id", [orgAId, orgBId]);
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
});
