// Ponto de entrada do container (Dockerfile → CMD ["node", "start.mjs"]).
//
// Faz duas coisas:
//   1. sobe o servidor do Next (server.js do build "standalone");
//   2. faz o papel do Vercel Cron (vercel.json), que não existe numa VPS:
//      chama /api/cron/process-events a cada minuto e /api/cron/backup uma
//      vez por dia às 06:00 UTC (03:00 de Brasília) — mesmos horários.
//
// As chamadas vão pro próprio container (127.0.0.1) com o CRON_SECRET, pelo
// mesmo caminho que a Vercel usaria — nenhuma regra de negócio mora aqui.
// Pra usar um agendador de fora em vez deste, defina DISABLE_INTERNAL_CRON=1.
import { spawn } from "node:child_process";

const port = process.env.PORT ?? "3000";
const base = `http://127.0.0.1:${port}`;

const server = spawn(process.execPath, ["server.js"], { stdio: "inherit", env: process.env });
// Se o servidor cair, o container cai junto — o EasyPanel/Docker reinicia.
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.kill(signal));
}

const secret = process.env.CRON_SECRET;

async function callCron(path, timeoutMs) {
  try {
    const response = await fetch(`${base}${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) console.error(`[cron] ${path} respondeu ${response.status}`);
  } catch (err) {
    console.error(`[cron] ${path} falhou:`, err instanceof Error ? err.message : err);
  }
}

if (process.env.DISABLE_INTERNAL_CRON === "1") {
  console.log("[cron] agendador interno desligado (DISABLE_INTERNAL_CRON=1).");
} else if (!secret) {
  console.error("[cron] CRON_SECRET vazio — fila, SLA, CSAT e backup NÃO vão rodar.");
} else {
  // Fila: a cada minuto, nunca duas ao mesmo tempo (se uma rodada demorar
  // mais de 1 min, a seguinte é pulada em vez de empilhar).
  let processing = false;
  setInterval(async () => {
    if (processing) return;
    processing = true;
    await callCron("/api/cron/process-events", 55_000);
    processing = false;
  }, 60_000);

  // Backup: confere a cada minuto se já é 06:00 UTC e se hoje ainda não rodou.
  let lastBackupDay = null;
  setInterval(() => {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    if (now.getUTCHours() === 6 && lastBackupDay !== today) {
      lastBackupDay = today;
      void callCron("/api/cron/backup", 300_000);
    }
  }, 60_000);

  console.log("[cron] agendador interno ligado: fila a cada 1 min, backup às 06:00 UTC.");
}
