import crypto from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Prova a migration 0025 contra o banco real: quem ativou o 2FA não lê
 * nada só com a senha (sessão aal1) — precisa do código (aal2).
 */
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const hasCredentials = Boolean(SUPABASE_URL && ANON_KEY && SERVICE_ROLE_KEY);

/** TOTP (RFC 6238) — o mesmo código de 6 dígitos que o app autenticador mostraria. */
function totp(base32Secret: string, now = Date.now()): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of base32Secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = crypto.createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, "0");
}

describe.skipIf(!hasCredentials)("2FA obrigatório no banco", () => {
  let admin: SupabaseClient;
  const suffix = Date.now();
  const email = `teste-mfa-${suffix}@example.com`;
  const password = "senha-de-teste-123";
  let userId: string;
  let orgId: string;
  let factorId: string;
  let secret: string;

  const newClient = () =>
    createSupabaseClient(SUPABASE_URL!, ANON_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });

  async function signInWithPasswordOnly() {
    const client = newClient();
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return client;
  }

  beforeAll(async () => {
    admin = createSupabaseClient(SUPABASE_URL!, SERVICE_ROLE_KEY!, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: user, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    userId = user.user.id;
    const { data: org } = await admin.from("organizations").insert({ name: "Org MFA", slug: `org-teste-mfa-${suffix}` }).select().single().throwOnError();
    orgId = org!.id;
    await admin.from("org_members").insert({ org_id: orgId, user_id: userId, role: "owner", accepted_at: new Date().toISOString() }).throwOnError();
    await admin.from("tags").insert({ org_id: orgId, name: "tag-mfa" }).throwOnError();
  });

  afterAll(async () => {
    if (orgId) await admin.from("organizations").delete().eq("id", orgId);
    if (userId) await admin.auth.admin.deleteUser(userId);
  });

  it("sem 2FA ativado, a senha basta (nada muda pra quem não usa)", async () => {
    const client = await signInWithPasswordOnly();
    const { data } = await client.from("tags").select("name").eq("org_id", orgId);
    expect(data).toEqual([{ name: "tag-mfa" }]);
  });

  it("ativa o 2FA com um código válido", async () => {
    const client = await signInWithPasswordOnly();
    const { data: enrolled, error } = await client.auth.mfa.enroll({ factorType: "totp", friendlyName: `teste-${suffix}` });
    expect(error).toBeNull();
    factorId = enrolled!.id;
    secret = enrolled!.totp.secret;
    const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
    expect(verifyError).toBeNull();
  });

  it("com 2FA ativado, só a senha (aal1) não lê nem grava nada", async () => {
    const client = await signInWithPasswordOnly();
    const { data } = await client.from("tags").select("name").eq("org_id", orgId);
    expect(data).toEqual([]);
    const { error } = await client.from("tags").insert({ org_id: orgId, name: "invasao" });
    expect(error).not.toBeNull();
  });

  it("com 2FA ativado, só a senha também não passa pelas funções do banco (SECURITY DEFINER)", async () => {
    const client = await signInWithPasswordOnly();
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const calls = [
      client.rpc("fn_anonymize_contact", { p_org_id: orgId, p_contact_id: fakeId }),
      client.rpc("fn_remove_org_member", { p_org_id: orgId, p_user_id: fakeId }),
      client.rpc("fn_queue_csat_survey", { p_conversation_id: fakeId }),
      client.rpc("fn_next_rotation_member", { p_team_id: fakeId }),
    ];
    for (const { error } of await Promise.all(calls)) {
      expect(error?.message).toContain("mfa_required");
    }
  });

  it("depois de digitar o código (aal2), lê normalmente", async () => {
    const client = await signInWithPasswordOnly();
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: totp(secret) });
    expect(error).toBeNull();
    const { data: aal } = await client.auth.mfa.getAuthenticatorAssuranceLevel();
    expect(aal?.currentLevel).toBe("aal2");
    const { data } = await client.from("tags").select("name").eq("org_id", orgId);
    expect(data).toEqual([{ name: "tag-mfa" }]);
  });

  it("código errado não passa", async () => {
    const client = await signInWithPasswordOnly();
    const wrong = totp(secret) === "000000" ? "111111" : "000000";
    const { error } = await client.auth.mfa.challengeAndVerify({ factorId, code: wrong });
    expect(error).not.toBeNull();
  });
});
