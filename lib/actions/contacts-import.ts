"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { contactSchema } from "@/lib/validation/contacts";
import { parseCsv } from "@/lib/reports/csv-parse";

export type ImportContactsState = {
  error?: string;
  summary?: {
    created: number;
    updated: number;
    skipped: number;
    errors: { line: number; reason: string }[];
  };
} | null;

const MAX_ROWS = 2000;
const NAME_HEADERS = ["nome", "name"];
const PHONE_HEADERS = ["telefone", "phone", "phone_e164", "telefone (formato internacional)"];
const EMAIL_HEADERS = ["e-mail", "email"];

export async function importContacts(
  _prevState: ImportContactsState,
  formData: FormData,
): Promise<ImportContactsState> {
  let membership;
  try {
    // Manager+ — diferente de criar um contato só (aberto a qualquer
    // membro), importar em massa pode criar ou sobrescrever muita coisa de
    // uma vez se o arquivo estiver errado.
    membership = await requireRole("manager");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecione um arquivo CSV." };
  }

  const text = await file.text();
  const rows = parseCsv(text);
  if (rows.length < 2) {
    return { error: "Arquivo vazio ou sem linhas de dados." };
  }
  if (rows.length - 1 > MAX_ROWS) {
    return { error: `Máximo de ${MAX_ROWS} contatos por importação — divida o arquivo em partes.` };
  }

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const nameIdx = header.findIndex((h) => NAME_HEADERS.includes(h));
  const phoneIdx = header.findIndex((h) => PHONE_HEADERS.includes(h));
  const emailIdx = header.findIndex((h) => EMAIL_HEADERS.includes(h));

  if (nameIdx === -1 || phoneIdx === -1) {
    return { error: "O arquivo precisa ter colunas de nome e telefone (a primeira linha é o cabeçalho)." };
  }

  const supabase = await createClient();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  const errors: { line: number; reason: string }[] = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const parsed = contactSchema.safeParse({
      name: cols[nameIdx]?.trim(),
      phone_e164: cols[phoneIdx]?.trim(),
      email: emailIdx >= 0 ? cols[emailIdx]?.trim() || undefined : undefined,
    });

    if (!parsed.success) {
      skipped++;
      errors.push({ line: i + 1, reason: parsed.error.issues[0]?.message ?? "Dados inválidos." });
      continue;
    }

    const { data: existing } = await supabase
      .from("contacts")
      .select("id")
      .eq("org_id", membership.orgId)
      .eq("phone_e164", parsed.data.phone_e164)
      .maybeSingle();

    // Importação nunca grava opt-in — importar uma planilha não é
    // consentimento de marketing (LGPD). Quem quiser marcar opt-in faz
    // isso contato por contato, ou numa forma que registre a origem real
    // do consentimento (lib/crm/consent.ts).
    if (existing) {
      const { error } = await supabase
        .from("contacts")
        .update({ name: parsed.data.name, email: parsed.data.email || null })
        .eq("id", existing.id)
        .eq("org_id", membership.orgId);
      if (error) {
        skipped++;
        errors.push({ line: i + 1, reason: "Falha ao atualizar contato existente." });
        continue;
      }
      updated++;
    } else {
      const { error } = await supabase.from("contacts").insert({
        org_id: membership.orgId,
        name: parsed.data.name,
        phone_e164: parsed.data.phone_e164,
        email: parsed.data.email || null,
      });
      if (error) {
        skipped++;
        errors.push({
          line: i + 1,
          reason: error.code === "23505" ? "E-mail já usado por outro contato." : "Falha ao criar contato.",
        });
        continue;
      }
      created++;
    }
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "contacts.imported",
    resourceType: "contacts",
    after: { created, updated, skipped, total_linhas: rows.length - 1 },
  });

  revalidatePath("/contatos");
  revalidatePath("/relatorios/contatos");

  return { summary: { created, updated, skipped, errors: errors.slice(0, 20) } };
}
