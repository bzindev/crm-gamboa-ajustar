export type PresenceStatus = "online" | "away" | "offline";

const STALE_AFTER_MS = 3 * 60 * 1000;

/**
 * Mesma regra usada em fn_presence_status (SQL) — mantida em espelho aqui
 * porque a UI precisa calcular o mesmo resultado sem ida ao banco (ex.:
 * ao reabrir a aba antes do próximo fetch). Se o heartbeat parou de
 * chegar, é offline mesmo que o valor gravado ainda diga outra coisa.
 */
export function resolvePresenceStatus(
  storedStatus: string | null | undefined,
  lastActiveAt: string | null | undefined,
): PresenceStatus {
  if (!lastActiveAt) return "offline";
  const age = Date.now() - new Date(lastActiveAt).getTime();
  if (age >= STALE_AFTER_MS) return "offline";
  return storedStatus === "away" ? "away" : "online";
}

export const PRESENCE_LABELS: Record<PresenceStatus, string> = {
  online: "Online",
  away: "Ausente",
  offline: "Offline",
};

export const PRESENCE_DOT_CLASSNAME: Record<PresenceStatus, string> = {
  online: "bg-emerald-500",
  away: "bg-amber-500",
  offline: "bg-zinc-500",
};
