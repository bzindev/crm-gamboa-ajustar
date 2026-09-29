// Sem "server-only": a tela lê/escreve estes filtros na URL e o endpoint
// usa o mesmo parser — um único lugar define o que cada parâmetro significa.
import { z } from "zod";

export const CONVERSATION_STATUSES = ["open", "pending", "resolved", "closed"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];

export const TEMPERATURE_FILTERS = ["hot", "warm", "cold", "none"] as const;
export type TemperatureFilter = (typeof TEMPERATURE_FILTERS)[number];

export const PERIODS = ["today", "yesterday", "7d", "30d", "this_month", "last_month", "custom"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABELS: Record<Period, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  this_month: "Este mês",
  last_month: "Mês passado",
  custom: "Personalizado",
};

export const DATE_FIELDS = ["activity", "created", "resolved"] as const;
export type DateField = (typeof DATE_FIELDS)[number];

export const DATE_FIELD_LABELS: Record<DateField, string> = {
  activity: "Última mensagem",
  created: "Criação da conversa",
  resolved: "Resolução / fechamento",
};

/** Valores especiais do filtro de vendedor, ao lado dos ids da equipe. */
export const VENDOR_ME = "me";
export const VENDOR_NONE = "none";

export type InboxFilters = {
  status: ConversationStatus | null;
  temperatures: TemperatureFilter[];
  tagIds: string[];
  tagMode: "any" | "all";
  /** ids de usuário, "me" (quem está vendo) e/ou "none" (sem responsável). */
  vendors: string[];
  teamIds: string[];
  stageIds: string[];
  dateField: DateField;
  period: Period | null;
  /** YYYY-MM-DD, só com period = "custom". */
  from: string | null;
  to: string | null;
  unread: boolean;
  awaiting: boolean;
  q: string;
};

export const DEFAULT_FILTERS: InboxFilters = {
  status: null,
  temperatures: [],
  tagIds: [],
  tagMode: "any",
  vendors: [],
  teamIds: [],
  stageIds: [],
  dateField: "activity",
  period: null,
  from: null,
  to: null,
  unread: false,
  awaiting: false,
  q: "",
};

const uuid = z.string().uuid();
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));
const vendor = z.union([uuid, z.literal(VENDOR_ME), z.literal(VENDOR_NONE)]);

/** Lista separada por vírgula; item inválido é descartado (link colado à mão não quebra a tela). */
function list<T>(raw: string | null, schema: z.ZodType<T>): T[] {
  if (!raw) return [];
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .flatMap((s) => {
      const parsed = schema.safeParse(s);
      return parsed.success ? [parsed.data] : [];
    });
  return [...new Set(items)].slice(0, 50);
}

function one<T>(raw: string | null, schema: z.ZodType<T>): T | null {
  if (raw === null) return null;
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** URL → filtros. Nunca lança: valor desconhecido vira "filtro desligado". */
export function parseInboxFilters(params: URLSearchParams): InboxFilters {
  const period = one(params.get("period"), z.enum(PERIODS));
  return {
    status: one(params.get("status"), z.enum(CONVERSATION_STATUSES)),
    temperatures: list(params.get("temp"), z.enum(TEMPERATURE_FILTERS)),
    tagIds: list(params.get("tags"), uuid),
    tagMode: params.get("tagMode") === "all" ? "all" : "any",
    vendors: list(params.get("vendor"), vendor),
    teamIds: list(params.get("team"), uuid),
    stageIds: list(params.get("stage"), uuid),
    dateField: one(params.get("date"), z.enum(DATE_FIELDS)) ?? "activity",
    period,
    from: period === "custom" ? one(params.get("from"), ymd) : null,
    to: period === "custom" ? one(params.get("to"), ymd) : null,
    unread: params.get("unread") === "1",
    awaiting: params.get("awaiting") === "1",
    q: (params.get("q") ?? "").trim().slice(0, 100),
  };
}

/** Filtros → URL. Só grava o que difere do padrão, sempre na mesma ordem. */
export function filtersToSearchParams(filters: InboxFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.q) params.set("q", filters.q);
  if (filters.status) params.set("status", filters.status);
  if (filters.temperatures.length) params.set("temp", filters.temperatures.join(","));
  if (filters.tagIds.length) {
    params.set("tags", filters.tagIds.join(","));
    if (filters.tagMode === "all") params.set("tagMode", "all");
  }
  if (filters.vendors.length) params.set("vendor", filters.vendors.join(","));
  if (filters.teamIds.length) params.set("team", filters.teamIds.join(","));
  if (filters.stageIds.length) params.set("stage", filters.stageIds.join(","));
  if (filters.period) {
    params.set("period", filters.period);
    if (filters.dateField !== "activity") params.set("date", filters.dateField);
    if (filters.period === "custom") {
      if (filters.from) params.set("from", filters.from);
      if (filters.to) params.set("to", filters.to);
    }
  }
  if (filters.unread) params.set("unread", "1");
  if (filters.awaiting) params.set("awaiting", "1");
  return params;
}

/** Quantos filtros estão ligados (a aba de status não conta — ela sempre aparece). */
export function countActiveFilters(filters: InboxFilters): number {
  return [
    filters.q !== "",
    filters.temperatures.length > 0,
    filters.tagIds.length > 0,
    filters.vendors.length > 0,
    filters.teamIds.length > 0,
    filters.stageIds.length > 0,
    filters.period !== null,
    filters.unread,
    filters.awaiting,
  ].filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Período → intervalo [início, fim) no horário de Brasília. O Brasil não tem
// horário de verão desde 2019, então o deslocamento é fixo em -03:00.
// ---------------------------------------------------------------------------
const TZ_OFFSET = "-03:00";

function todayInBrazil(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function startOfDay(day: string): Date {
  return new Date(`${day}T00:00:00${TZ_OFFSET}`);
}

export function resolvePeriod(
  filters: Pick<InboxFilters, "period" | "from" | "to">,
  now: Date = new Date(),
): { from: Date | null; to: Date | null } {
  const today = todayInBrazil(now);
  const monthStart = `${today.slice(0, 8)}01`;
  switch (filters.period) {
    case "today":
      return { from: startOfDay(today), to: startOfDay(addDays(today, 1)) };
    case "yesterday":
      return { from: startOfDay(addDays(today, -1)), to: startOfDay(today) };
    case "7d":
      return { from: startOfDay(addDays(today, -6)), to: startOfDay(addDays(today, 1)) };
    case "30d":
      return { from: startOfDay(addDays(today, -29)), to: startOfDay(addDays(today, 1)) };
    case "this_month": {
      const next = new Date(`${monthStart}T00:00:00Z`);
      next.setUTCMonth(next.getUTCMonth() + 1);
      return { from: startOfDay(monthStart), to: startOfDay(next.toISOString().slice(0, 10)) };
    }
    case "last_month": {
      const previous = new Date(`${monthStart}T00:00:00Z`);
      previous.setUTCMonth(previous.getUTCMonth() - 1);
      return { from: startOfDay(previous.toISOString().slice(0, 10)), to: startOfDay(monthStart) };
    }
    case "custom":
      // "até 10/09" inclui o dia 10 inteiro — o fim vira o começo do dia 11.
      return {
        from: filters.from ? startOfDay(filters.from) : null,
        to: filters.to ? startOfDay(addDays(filters.to, 1)) : null,
      };
    default:
      return { from: null, to: null };
  }
}
