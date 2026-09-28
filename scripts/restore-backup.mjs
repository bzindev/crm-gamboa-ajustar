// Restaura um backup gerado por /api/cron/backup (lib/backup/run-backup.ts).
//
//   node scripts/restore-backup.mjs --list                 lista os backups guardados
//   node scripts/restore-backup.mjs <arquivo>              SIMULA (só mostra o que faria)
//   node scripts/restore-backup.mjs <arquivo> --apply      restaura de verdade
//
// <arquivo> pode ser o nome no Storage (ex.: 2026-09-28T17-55-44-652Z.json.gz)
// ou um caminho local. Usa .env.local (service role). Restaurar = UPSERT por
// chave primária, na ordem pais→filhos: linha que existe é sobrescrita com
// a versão do backup; linha criada depois do backup NÃO é apagada.
// Pré-requisito: os usuários (auth.users) precisam existir — profiles aponta
// pra eles, e o backup do app não copia contas de login.
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local", quiet: true });
const BUCKET = "backups";
const BATCH = 500;

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const args = process.argv.slice(2);
const apply = args.includes("--apply");

// Sem process.exit(): no Windows ele derruba o Node se ainda houver
// conexão HTTP aberta (bug do libuv) — erros saem pelo exitCode.
async function main() {
  if (args.includes("--list")) {
    const { data, error } = await supabase.storage.from(BUCKET).list("", { limit: 100, sortBy: { column: "name", order: "desc" } });
    if (error) throw error;
    for (const f of data) console.log(f.name, `${Math.round((f.metadata?.size ?? 0) / 1024)} KB`);
    return;
  }

  const target = args.find((a) => !a.startsWith("--"));
  if (!target) throw new Error("Informe o arquivo (ou --list).");

  let raw;
  if (fs.existsSync(target)) {
    raw = fs.readFileSync(target);
  } else {
    const { data, error } = await supabase.storage.from(BUCKET).download(target);
    if (error) throw new Error(`download: ${error.message}`);
    raw = Buffer.from(await data.arrayBuffer());
  }

  const backup = JSON.parse(gunzipSync(raw).toString("utf8"));
  console.log(`Backup de ${backup.created_at} — ${apply ? "RESTAURANDO" : "simulação (use --apply pra valer)"}`);

  for (const { name, order } of backup.schema) {
    const rows = backup.tables[name] ?? [];
    console.log(`  ${name.padEnd(26)} ${String(rows.length).padStart(6)} linha(s)`);
    if (!apply || rows.length === 0) continue;
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from(name).upsert(rows.slice(i, i + BATCH), { onConflict: order.join(",") });
      if (error) throw new Error(`${name}: ${error.message}`);
    }
  }
  console.log(apply ? "Restauração concluída." : "Nada foi alterado.");
}

main().catch((err) => {
  console.error("ERRO:", err.message);
  process.exitCode = 1;
});
