"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { contactSchema } from "@/lib/validation/contacts";
import { parseCsv } from "@/lib/reports/csv-parse";
import { normalizeBrazilianPhone } from "@/lib/crm/phone-normalize";

const MAX_ROWS = 10000;
const INSERT_CHUNK_SIZE = 500;
const NAME_HEADERS = ["nome", "name"];
const PHONE_HEADERS = ["telefone", "phone", "phone_e164", "telefone (formato internacional)"];
const EMAIL_HEADERS = ["e-mail", "email"];

export type ImportRow = {
  name: string;
  phone: string;
  email: string | null;
  action: "create" | "update";
  existingId?: string;
};

export type ImportPreviewState = {
  error?: string;
  rows?: ImportRow[];
  errors?: { line: number; reason: string }[];
  totalRows?: number;
} | null;

export type ImportCommitState = {
  error?: string;
  summary?: { created: number; updated: number; failed: number };
} | null;

/**
 * Só analisa — nada é gravado aqui. Normaliza telefone brasileiro em
 * qualquer formato comum (com/sem DDI, com/sem pontuação, com/sem o 9º
 * dígito) antes de validar, porque planilha exportada de sistema de
 * telefonia raramente já vem em E.164 pronto. Devolve a lista pronta pra
 * `commitImportContacts` escrever, depois que a pessoa conferir o
 * resultado — importar sem mostrar antes o que vai acontecer é arriscado
 * demais numa operação em massa.
 */
export async function previewImportContacts(
  _prevState: ImportPreviewState,
  formData: FormData,
): Promise<ImportPreviewState> {
  let membership;
  try {
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

  const errors: { line: number; reason: string }[] = [];
  const validated: { line: number; name: string; phone: string; email: string | null }[] = [];
  const seenPhones = new Set<string>();

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i];
    const rawPhone = cols[phoneIdx]?.trim() ?? "";
    const normalized = normalizeBrazilianPhone(rawPhone);

    if (normalized.error) {
      errors.push({ line: i + 1, reason: normalized.error });
      continue;
    }

    const parsed = contactSchema.safeParse({
      name: cols[nameIdx]?.trim(),
      phone_e164: normalized.phone,
      email: emailIdx >= 0 ? cols[emailIdx]?.trim() || undefined : undefined,
    });

    if (!parsed.success) {
      errors.push({ line: i + 1, reason: parsed.error.issues[0]?.message ?? "Dados inválidos." });
      continue;
    }

    // Mesmo telefone duas vezes na própria planilha (comum depois de
    // normalizar variações do mesmo número) — mantém só a primeira
    // ocorrência, resto vira "atualiza" na hora do commit por já estar na
    // lista com o mesmo telefone.
    if (seenPhones.has(parsed.data.phone_e164)) {
      errors.push({ line: i + 1, reason: "Telefone duplicado nesta mesma planilha." });
      continue;
    }
    seenPhones.add(parsed.data.phone_e164);

    validated.push({ line: i + 1, name: parsed.data.name, phone: parsed.data.phone_e164, email: parsed.data.email || null });
  }

  const supabase = await createClient();
  const existingByPhone = new Map<string, string>();
  if (validated.length > 0) {
    // Uma consulta só pra todos os telefones, não uma por linha — planilha
    // de milhares de contatos não pode virar milhares de idas ao banco.
    const phones = validated.map((v) => v.phone);
    const { data: existing } = await supabase
      .from("contacts")
      .select("id, phone_e164")
      .eq("org_id", membership.orgId)
      .in("phone_e164", phones);
    for (const c of existing ?? []) existingByPhone.set(c.phone_e164, c.id);
  }

  const previewRows: ImportRow[] = validated.map((v) => {
    const existingId = existingByPhone.get(v.phone);
    return {
      name: v.name,
      phone: v.phone,
      email: v.email,
      action: existingId ? "update" : "create",
      existingId,
    };
  });

  return { rows: previewRows, errors, totalRows: rows.length - 1 };
}

/**
 * Escreve de fato — chamado só depois que a pessoa confirmou o preview.
 * Recebe a lista já normalizada e validada (não reprocessa o arquivo).
 * Insere em lotes (não um insert por linha) pra planilha grande não
 * estourar tempo de execução da function.
 */
export async function commitImportContacts(rows: ImportRow[]): Promise<ImportCommitState> {
  let membership;
  try {
    membership = await requireRole("manager");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "Nada pra importar." };
  }
  if (rows.length > MAX_ROWS) {
    return { error: `Máximo de ${MAX_ROWS} contatos por importação.` };
  }

  const supabase = await createClient();
  let created = 0;
  let updated = 0;
  let failed = 0;

  const toCreate = rows.filter((r) => r.action === "create");
  const toUpdate = rows.filter((r) => r.action === "update" && r.existingId);

  // Importação nunca grava opt-in — consentimento de marketing não se
  // herda de planilha (LGPD). Quem marca opt-in faz isso por contato
  // (lib/crm/consent.ts).
  for (let i = 0; i < toCreate.length; i += INSERT_CHUNK_SIZE) {
    const chunk = toCreate.slice(i, i + INSERT_CHUNK_SIZE).map((r) => ({
      org_id: membership.orgId,
      name: r.name,
      phone_e164: r.phone,
      email: r.email,
    }));
    const { error, count } = await supabase.from("contacts").insert(chunk, { count: "exact" });
    if (error) {
      // Um lote inteiro falhar (ex.: e-mail duplicado dentro do lote) não
      // deveria travar os demais lotes — conta como falha e segue.
      failed += chunk.length;
      console.error("[contacts-import] lote de criação falhou:", error.code, error.message);
      continue;
    }
    created += count ?? chunk.length;
  }

  for (const row of toUpdate) {
    const { error } = await supabase
      .from("contacts")
      .update({ name: row.name, email: row.email })
      .eq("id", row.existingId!)
      .eq("org_id", membership.orgId);
    if (error) {
      failed++;
      continue;
    }
    updated++;
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "contacts.imported",
    resourceType: "contacts",
    after: { created, updated, failed, total_linhas: rows.length },
  });

  revalidatePath("/contatos");
  revalidatePath("/relatorios/contatos");

  return { summary: { created, updated, failed } };
}
