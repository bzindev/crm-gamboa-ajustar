export type BusinessHours = {
  weekday_open: string; // "HH:MM"
  weekday_close: string;
  saturday_enabled: boolean;
  saturday_open: string;
  saturday_close: string;
};

export const DEFAULT_BUSINESS_HOURS: BusinessHours = {
  weekday_open: "08:00",
  weekday_close: "18:00",
  saturday_enabled: false,
  saturday_open: "08:00",
  saturday_close: "13:00",
};

function parseHours(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return h * 60 + (m || 0);
}

// America/Sao_Paulo fixo, não configurável ainda — em produção o servidor
// roda em UTC (Vercel), então usar new Date().getHours() direto daria
// horário errado. Todo o resto do app já assume Brasil (moeda, locale
// pt-BR), então isso não é uma limitação nova, só explícita aqui.
export function isWithinBusinessHours(hours: BusinessHours, at: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);

  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const nowMinutes = hour * 60 + minute;

  if (weekday === "Sun") return false;

  if (weekday === "Sat") {
    if (!hours.saturday_enabled) return false;
    return nowMinutes >= parseHours(hours.saturday_open) && nowMinutes < parseHours(hours.saturday_close);
  }

  return nowMinutes >= parseHours(hours.weekday_open) && nowMinutes < parseHours(hours.weekday_close);
}
