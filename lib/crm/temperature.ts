// Sem "server-only": usado na lista, no topo da conversa e nas ações.

export type Temperature = "hot" | "warm" | "cold";

export const TEMPERATURES: { value: Temperature; label: string; className: string }[] = [
  { value: "hot", label: "🔥 Quente", className: "border-red-500/40 bg-red-500/15 text-red-300" },
  { value: "warm", label: "🌤 Morno", className: "border-orange-500/40 bg-orange-500/15 text-orange-300" },
  { value: "cold", label: "❄️ Frio", className: "border-sky-500/40 bg-sky-500/15 text-sky-300" },
];

export const TEMPERATURE_BY_VALUE = Object.fromEntries(TEMPERATURES.map((t) => [t.value, t])) as Record<
  Temperature,
  (typeof TEMPERATURES)[number]
>;

/** Cor de etiqueta nova, estável pelo nome (a mesma etiqueta sempre sai com a mesma cor). */
const TAG_COLORS = ["#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#84cc16"];
export function colorForTag(name: string): string {
  let hash = 0;
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TAG_COLORS[hash % TAG_COLORS.length];
}
