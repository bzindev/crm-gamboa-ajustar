// Sem "server-only": funções puras, testadas em tests/csat.test.ts.

/**
 * Aceita só uma resposta que seja claramente a nota: "5", " 4 ", "5!",
 * "5️⃣". Qualquer coisa além disso ("5 carros", "quero falar com alguém")
 * é conversa normal, não nota — melhor perder uma avaliação do que
 * engolir uma mensagem de verdade do cliente.
 */
export function parseCsatRating(text: string | null): number | null {
  if (!text) return null;
  const normalized = text.replace(/[️⃣]/g, "").trim();
  const match = normalized.match(/^([1-5])\s*[!.]?$/);
  return match ? Number(match[1]) : null;
}

export type CsatSurveyRow = {
  agent_id: string | null;
  status: string;
  rating: number | null;
  sent_at: string | null;
};

export type CsatSummary = {
  sent: number;
  answered: number;
  responseRate: number | null;
  average: number | null;
  /** % de notas 4 ou 5. */
  satisfiedPct: number | null;
  byAgent: { agentId: string; name: string; answered: number; average: number }[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function summarizeCsat(
  surveys: CsatSurveyRow[],
  userNames: Map<string, string>,
  isInPeriod: (dateStr: string) => boolean,
): CsatSummary {
  const inPeriod = surveys.filter((s) => s.sent_at && isInPeriod(s.sent_at) && (s.status === "sent" || s.status === "answered"));
  const answered = inPeriod.filter((s): s is CsatSurveyRow & { rating: number } => s.status === "answered" && s.rating !== null);
  const total = answered.reduce((sum, s) => sum + s.rating, 0);

  const perAgent = new Map<string, number[]>();
  for (const s of answered) {
    if (!s.agent_id) continue;
    perAgent.set(s.agent_id, [...(perAgent.get(s.agent_id) ?? []), s.rating]);
  }

  return {
    sent: inPeriod.length,
    answered: answered.length,
    responseRate: inPeriod.length ? Math.round((answered.length / inPeriod.length) * 100) : null,
    average: answered.length ? round1(total / answered.length) : null,
    satisfiedPct: answered.length ? Math.round((answered.filter((s) => s.rating >= 4).length / answered.length) * 100) : null,
    byAgent: [...perAgent.entries()]
      .map(([agentId, ratings]) => ({
        agentId,
        name: userNames.get(agentId) ?? "Usuário removido",
        answered: ratings.length,
        average: round1(ratings.reduce((a, b) => a + b, 0) / ratings.length),
      }))
      .sort((a, b) => b.average - a.average || b.answered - a.answered),
  };
}
