const formatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "—";
  return formatter.format(cents / 100);
}
