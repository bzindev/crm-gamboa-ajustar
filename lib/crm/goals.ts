// Sem "server-only": função pura, testada em tests/goals.test.ts.

export type GoalRow = {
  id: string;
  user_id: string | null;
  target_won: number;
  target_value_cents: number | null;
};

export type GoalLead = {
  owner_id: string | null;
  status: string;
  value_cents: number | null;
  updated_at: string;
};

export type GoalProgress = {
  goalId: string;
  userId: string | null;
  name: string;
  targetWon: number;
  won: number;
  wonPct: number;
  targetValueCents: number | null;
  wonValueCents: number;
  valuePct: number | null;
};

const monthFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
});

/**
 * "2026-09" no fuso de São Paulo — o servidor roda em UTC (Vercel), então
 * uma venda às 22h do dia 30 cairia no mês seguinte se usasse a data crua.
 */
export function monthKey(date: Date | string): string {
  const parts = monthFormatter.formatToParts(typeof date === "string" ? new Date(date) : date);
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  return `${year}-${month}`;
}

/** "2026-09" → "2026-09-01" (formato da coluna goals.month). */
export function monthKeyToDate(key: string): string {
  return `${key}-01`;
}

function pct(value: number, target: number): number {
  return Math.round((value / target) * 100);
}

/**
 * Meta de equipe (user_id nulo) conta toda venda do mês, inclusive de lead
 * sem responsável; meta individual conta só os leads daquele vendedor.
 * Venda = lead com status "won" cujo último update caiu no mês — mesmo
 * critério do dashboard e do ranking.
 */
export function computeGoalProgress(
  goals: GoalRow[],
  leads: GoalLead[],
  month: string,
  userNames: Map<string, string>,
): GoalProgress[] {
  const wonInMonth = leads.filter((l) => l.status === "won" && monthKey(l.updated_at) === month);

  return goals
    .map((goal) => {
      const mine = goal.user_id ? wonInMonth.filter((l) => l.owner_id === goal.user_id) : wonInMonth;
      const wonValueCents = mine.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);
      return {
        goalId: goal.id,
        userId: goal.user_id,
        name: goal.user_id ? userNames.get(goal.user_id) ?? "Usuário removido" : "Equipe inteira",
        targetWon: goal.target_won,
        won: mine.length,
        wonPct: pct(mine.length, goal.target_won),
        targetValueCents: goal.target_value_cents,
        wonValueCents,
        valuePct: goal.target_value_cents ? pct(wonValueCents, goal.target_value_cents) : null,
      };
    })
    .sort((a, b) => (a.userId === null ? -1 : b.userId === null ? 1 : a.name.localeCompare(b.name)));
}
