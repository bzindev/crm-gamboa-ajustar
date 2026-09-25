import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type DuplicateContact = {
  id: string;
  name: string | null;
  field: "phone" | "email";
};

/**
 * Chamado só depois que o banco já recusou o INSERT/UPDATE com 23505 — a
 * trava de verdade continua sendo o índice único (sem corrida possível);
 * isto aqui só descobre QUEM é o contato que já existe, pra tela mostrar o
 * nome e um link em vez de um erro seco. Escopado por org_id: nunca revela
 * contato de outra organização.
 */
export async function findDuplicateContact(
  supabase: SupabaseClient,
  params: { orgId: string; phone: string; email?: string | null; excludeId?: string },
): Promise<DuplicateContact | null> {
  let byPhone = supabase
    .from("contacts")
    .select("id, name")
    .eq("org_id", params.orgId)
    .eq("phone_e164", params.phone);
  if (params.excludeId) byPhone = byPhone.neq("id", params.excludeId);
  const { data: phoneMatch } = await byPhone.limit(1).maybeSingle();
  if (phoneMatch) return { id: phoneMatch.id, name: phoneMatch.name, field: "phone" };

  if (params.email) {
    let byEmail = supabase
      .from("contacts")
      .select("id, name")
      .eq("org_id", params.orgId)
      .ilike("email", params.email.replace(/[\\%_]/g, "\\$&"));
    if (params.excludeId) byEmail = byEmail.neq("id", params.excludeId);
    const { data: emailMatch } = await byEmail.limit(1).maybeSingle();
    if (emailMatch) return { id: emailMatch.id, name: emailMatch.name, field: "email" };
  }

  return null;
}

export function duplicateMessage(duplicate: DuplicateContact | null, fallbackField: "phone" | "email"): string {
  const field = duplicate?.field ?? fallbackField;
  const what = field === "email" ? "esse e-mail" : "esse telefone";
  return duplicate?.name
    ? `Já existe um contato com ${what}: ${duplicate.name}.`
    : `Já existe um contato com ${what}.`;
}
