import "server-only";
import { gzipSync } from "node:zlib";
import type { createAdminClient } from "@/lib/supabase/admin";
import { BACKUP_BUCKET, BACKUP_KEEP, BACKUP_TABLES } from "@/lib/backup/tables";

type AdminClient = ReturnType<typeof createAdminClient>;

const PAGE_SIZE = 1000;

export type BackupResult = { file: string; bytes: number; counts: Record<string, number>; deleted: string[] };

async function readAll(supabase: AdminClient, table: string, order: string[]): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = supabase.from(table).select("*");
    for (const column of order) query = query.order(column, { ascending: true });
    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) return rows;
  }
}

/**
 * Cópia de todas as tabelas do app num arquivo compactado, num bucket
 * PRIVADO do Storage (só a service role lê). Não depende do plano do
 * Supabase ter backup gerenciado. Guarda os últimos BACKUP_KEEP arquivos.
 * Restaurar: scripts/restore-backup.mjs.
 */
export async function runBackup(supabase: AdminClient, now = new Date()): Promise<BackupResult> {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (!buckets?.some((b) => b.name === BACKUP_BUCKET)) {
    const { error } = await supabase.storage.createBucket(BACKUP_BUCKET, { public: false });
    if (error && !error.message.toLowerCase().includes("already exists")) throw new Error(`bucket: ${error.message}`);
  }

  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const { name, order } of BACKUP_TABLES) {
    tables[name] = await readAll(supabase, name, order);
    counts[name] = tables[name].length;
  }

  // `schema` leva a ordem e as chaves junto no arquivo — o script de
  // restauração não depende do código do app pra saber em que ordem inserir.
  const body = gzipSync(JSON.stringify({ version: 1, created_at: now.toISOString(), schema: BACKUP_TABLES, counts, tables }));
  const file = `${now.toISOString().replace(/[:.]/g, "-")}.json.gz`;
  const { error: uploadError } = await supabase.storage.from(BACKUP_BUCKET).upload(file, body, {
    contentType: "application/gzip",
    upsert: false,
  });
  if (uploadError) throw new Error(`upload: ${uploadError.message}`);

  // Nome começa pela data ISO → ordem alfabética = ordem cronológica.
  const { data: existing } = await supabase.storage.from(BACKUP_BUCKET).list("", { limit: 1000, sortBy: { column: "name", order: "desc" } });
  const old = (existing ?? []).map((f) => f.name).filter((n) => n.endsWith(".json.gz")).slice(BACKUP_KEEP);
  if (old.length) await supabase.storage.from(BACKUP_BUCKET).remove(old);

  return { file, bytes: body.length, counts, deleted: old };
}
