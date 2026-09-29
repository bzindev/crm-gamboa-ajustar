import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Cadastrar usuário e editar membro (nome/senha) contra banco e Auth reais.
 * Só "quem está logado" é simulado (requireRole) — a ação roda de verdade.
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

const session = vi.hoisted(() => ({ current: null as null | { orgId: string; userId: string; role: string; orgName: string; orgSlug: string } }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/auth/require-role", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
  requireRole: async () => session.current,
}));
vi.mock("@/lib/supabase/server", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  return {
    createClient: async () =>
      createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } }),
  };
});

const { createUserWithPassword, updateMember } = await import("@/lib/actions/users");

describe.skipIf(!hasCredentials)("gestão de usuários pelo admin", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const password = "senha-inicial-123";
  const email = (k: string) => `teste-users-${k}-${suffix}@example.com`;
  const ids: Record<string, string> = {};
  let orgId: string;
  let otherOrgId: string;

  const as = (key: string, role: string) => {
    session.current = { orgId, userId: ids[key], role, orgName: "Org", orgSlug: "org" };
  };
  const form = (fields: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.set(k, v);
    return fd;
  };
  const canLogin = async (mail: string, pass: string) => {
    const client = createSupabaseClient(SUPABASE_URL!, ANON_KEY!, { auth: { persistSession: false } });
    const { error } = await client.auth.signInWithPassword({ email: mail, password: pass });
    return !error;
  };

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
    orgId = (await admin.from("organizations").insert({ name: "Org Users", slug: `org-teste-users-${suffix}` }).select().single().throwOnError()).data!.id;
    otherOrgId = (await admin.from("organizations").insert({ name: "Org Users 2", slug: `org-teste-users2-${suffix}` }).select().single().throwOnError()).data!.id;
    const people: [string, string][] = [["dono", "owner"], ["admin", "admin"], ["admin2", "admin"], ["vendedor", "agent"], ["multi", "agent"]];
    for (const [key, role] of people) {
      const { data, error } = await admin.auth.admin.createUser({ email: email(key), password, email_confirm: true, user_metadata: { full_name: key } });
      if (error) throw error;
      ids[key] = data.user.id;
      await admin.from("org_members").insert({ org_id: orgId, user_id: ids[key], role, accepted_at: new Date().toISOString() }).throwOnError();
    }
    await admin.from("org_members").insert({ org_id: otherOrgId, user_id: ids.multi, role: "owner", accepted_at: new Date().toISOString() }).throwOnError();
  });

  afterAll(async () => {
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const created = data.users.find((u) => u.email === email("novo"));
    await admin.from("organizations").delete().in("id", [orgId, otherOrgId].filter(Boolean));
    for (const id of [...Object.values(ids), created?.id].filter(Boolean) as string[]) await admin.auth.admin.deleteUser(id);
  });

  it("admin edita nome e senha de vendedor — a senha nova entra, a antiga não", async () => {
    as("admin", "admin");
    const result = await updateMember(null, form({ userId: ids.vendedor, fullName: "Vendedor Renomeado", password: "Nova-Senha-7788" }));
    expect(result).toEqual({ success: true });
    const { data } = await admin.from("profiles").select("full_name").eq("id", ids.vendedor).single();
    expect(data!.full_name).toBe("Vendedor Renomeado");
    expect(await canLogin(email("vendedor"), "Nova-Senha-7788")).toBe(true);
    expect(await canLogin(email("vendedor"), password)).toBe(false);
  });

  it("senha em branco mantém a atual", async () => {
    as("admin", "admin");
    expect(await updateMember(null, form({ userId: ids.vendedor, fullName: "Vendedor", password: "" }))).toEqual({ success: true });
    expect(await canLogin(email("vendedor"), "Nova-Senha-7788")).toBe(true);
  });

  it.each([
    ["dono", "O dono só pode ser editado por ele mesmo."],
    ["admin2", "Só o dono edita outro administrador."],
    ["multi", "outra organização"],
  ])("admin não edita %s", async (target, message) => {
    as("admin", "admin");
    const result = await updateMember(null, form({ userId: ids[target], fullName: "x y", password: "Qualquer-Senha-99" }));
    expect(result?.error).toContain(message);
  });

  it("ninguém troca a própria senha por aqui (só o nome)", async () => {
    as("admin", "admin");
    expect((await updateMember(null, form({ userId: ids.admin, fullName: "Eu", password: "Minha-Nova-9999" })))?.error).toContain("Segurança");
    expect(await updateMember(null, form({ userId: ids.admin, fullName: "Eu Mesmo", password: "" }))).toEqual({ success: true });
  });

  it("senha curta é recusada", async () => {
    as("dono", "owner");
    expect((await updateMember(null, form({ userId: ids.vendedor, fullName: "Vendedor", password: "curta" })))?.error).toMatch(/10 caracteres/);
  });

  it("dono edita outro admin", async () => {
    as("dono", "owner");
    expect(await updateMember(null, form({ userId: ids.admin2, fullName: "Admin Dois", password: "Senha-Do-Admin2" }))).toEqual({ success: true });
    expect(await canLogin(email("admin2"), "Senha-Do-Admin2")).toBe(true);
  });

  it("cadastra usuário novo com senha, já dentro da organização", async () => {
    as("admin", "admin");
    const result = await createUserWithPassword(null, form({ fullName: "Novo Vendedor", email: email("novo"), role: "agent", password: "Senha-Novo-1234" }));
    expect(result).toEqual({ created: { email: email("novo") } });
    const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const user = data.users.find((u) => u.email === email("novo"))!;
    const { data: member } = await admin.from("org_members").select("role, accepted_at").eq("org_id", orgId).eq("user_id", user.id).single();
    expect(member!.role).toBe("agent");
    expect(member!.accepted_at).not.toBeNull();
    expect(await canLogin(email("novo"), "Senha-Novo-1234")).toBe(true);
  });

  it("e-mail que já tem conta não é sobrescrito", async () => {
    as("admin", "admin");
    const result = await createUserWithPassword(null, form({ fullName: "Tentativa", email: email("multi"), role: "agent", password: "Senha-Invasora-1" }));
    expect(result?.error).toContain("Já existe uma conta");
    expect(await canLogin(email("multi"), password)).toBe(true);
  });
});
