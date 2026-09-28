// Sem "server-only": função pura, usada no servidor (Funil, Dashboard) e
// testada em tests/lead-score.test.ts. Regra simples e explicável de
// propósito — o vendedor precisa entender por que um lead está no topo.

export type ScoreInput = {
  status: "open" | "won" | "lost";
  temperature: "cold" | "warm" | "hot";
  valueCents: number | null;
  /** Posição da etapa entre as etapas NÃO finais (0 = primeira). */
  stageIndex: number;
  openStageCount: number;
  daysInStage: number;
  stageAlertDays: number;
  /** Última mensagem do cliente em qualquer conversa dele. */
  lastInboundAt: string | null;
  now?: Date;
};

export type LeadScore = {
  score: number;
  level: "alta" | "media" | "baixa";
  reasons: string[];
};

const TEMPERATURE_POINTS = { hot: 35, warm: 20, cold: 5 } as const;
const TEMPERATURE_LABEL = { hot: "quente", warm: "morno", cold: "frio" } as const;
const HOUR = 60 * 60 * 1000;

/** Lead ganho/perdido não tem prioridade de atendimento — devolve null. */
export function scoreLead(input: ScoreInput): LeadScore | null {
  if (input.status !== "open") return null;

  const reasons: string[] = [];
  let score: number = TEMPERATURE_POINTS[input.temperature];
  reasons.push(`${TEMPERATURE_LABEL[input.temperature]} (+${TEMPERATURE_POINTS[input.temperature]})`);

  if (input.openStageCount > 1) {
    const progress = Math.round((25 * Math.min(input.stageIndex, input.openStageCount - 1)) / (input.openStageCount - 1));
    if (progress > 0) {
      score += progress;
      reasons.push(`avançado no funil (+${progress})`);
    }
  }

  if ((input.valueCents ?? 0) > 0) {
    score += 10;
    reasons.push("tem valor de negócio (+10)");
  }

  if (input.lastInboundAt) {
    const hoursAgo = ((input.now ?? new Date()).getTime() - new Date(input.lastInboundAt).getTime()) / HOUR;
    if (hoursAgo <= 48) {
      score += 25;
      reasons.push("cliente falou nas últimas 48h (+25)");
    } else if (hoursAgo <= 24 * 7) {
      score += 12;
      reasons.push("cliente falou nos últimos 7 dias (+12)");
    }
  }

  if (input.daysInStage >= input.stageAlertDays * 2) {
    score -= 25;
    reasons.push(`parado há ${input.daysInStage} dias (−25)`);
  } else if (input.daysInStage >= input.stageAlertDays) {
    score -= 15;
    reasons.push(`parado há ${input.daysInStage} dias (−15)`);
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 70 ? "alta" : score >= 40 ? "media" : "baixa";
  return { score, level, reasons };
}

export function daysSinceDate(dateStr: string, now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(dateStr).getTime()) / (24 * HOUR));
}

/** Índice de cada etapa não final, na ordem do funil — base do "avançado no funil". */
export function openStageIndex(
  stages: { id: string; position: number; is_won: boolean; is_lost: boolean }[],
): { indexById: Map<string, number>; count: number } {
  const open = [...stages].filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.position - b.position);
  return { indexById: new Map(open.map((s, i) => [s.id, i])), count: open.length };
}

/** Última mensagem recebida por contato (um contato pode ter mais de uma conversa). */
export function lastInboundByContact(
  conversations: { contact_id: string; last_inbound_at: string | null }[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of conversations) {
    if (!c.last_inbound_at) continue;
    const current = map.get(c.contact_id);
    if (!current || c.last_inbound_at > current) map.set(c.contact_id, c.last_inbound_at);
  }
  return map;
}
