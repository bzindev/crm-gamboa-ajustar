// Sem "server-only" de propósito: função pura, testada direto no Vitest
// (tests/vendor-ranking.test.ts). A busca no banco fica em
// vendor-ranking-data.ts.

export type RankingMessage = {
  conversation_id: string;
  direction: "inbound" | "outbound";
  created_at: string;
  sent_by: string | null;
};

export type RankingLead = {
  owner_id: string | null;
  status: string;
  value_cents: number | null;
  updated_at: string;
};

export type RankingMember = { userId: string; name: string };

export type VendorRow = {
  userId: string;
  name: string;
  conversations: number;
  messagesSent: number;
  avgResponseMinutes: number | null;
  won: number;
  lost: number;
  conversionRate: number | null;
  wonValueCents: number;
};

export type VendorRanking = {
  rows: VendorRow[];
  teamAvgResponseMinutes: number | null;
};

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

/**
 * Tempo de resposta = da primeira mensagem do cliente (numa sequência sem
 * resposta) até a próxima mensagem enviada por um vendedor, creditado a
 * quem respondeu. Mensagem de saída sem `sent_by` (template do disparo em
 * massa, enviado pelo worker) não conta como resposta de ninguém.
 */
export function buildVendorRanking(input: {
  messages: RankingMessage[];
  leads: RankingLead[];
  members: RankingMember[];
  isInPeriod: (dateStr: string) => boolean;
}): VendorRanking {
  const stats = new Map<string, VendorRow & { samples: number[]; conversationIds: Set<string> }>();
  for (const member of input.members) {
    stats.set(member.userId, {
      userId: member.userId,
      name: member.name,
      conversations: 0,
      messagesSent: 0,
      avgResponseMinutes: null,
      won: 0,
      lost: 0,
      conversionRate: null,
      wonValueCents: 0,
      samples: [],
      conversationIds: new Set(),
    });
  }

  const sorted = [...input.messages].sort((a, b) =>
    a.conversation_id === b.conversation_id
      ? a.created_at.localeCompare(b.created_at)
      : a.conversation_id.localeCompare(b.conversation_id),
  );

  const waitingSince = new Map<string, string>();
  const teamSamples: number[] = [];

  for (const message of sorted) {
    if (message.direction === "inbound") {
      if (!waitingSince.has(message.conversation_id)) {
        waitingSince.set(message.conversation_id, message.created_at);
      }
      continue;
    }

    if (!message.sent_by) continue;
    const vendor = stats.get(message.sent_by);

    const since = waitingSince.get(message.conversation_id);
    if (since) {
      const minutes = (new Date(message.created_at).getTime() - new Date(since).getTime()) / 60000;
      teamSamples.push(minutes);
      vendor?.samples.push(minutes);
      waitingSince.delete(message.conversation_id);
    }

    if (vendor) {
      vendor.messagesSent += 1;
      vendor.conversationIds.add(message.conversation_id);
    }
  }

  for (const lead of input.leads) {
    if (!lead.owner_id || !input.isInPeriod(lead.updated_at)) continue;
    const vendor = stats.get(lead.owner_id);
    if (!vendor) continue;
    if (lead.status === "won") {
      vendor.won += 1;
      vendor.wonValueCents += lead.value_cents ?? 0;
    } else if (lead.status === "lost") {
      vendor.lost += 1;
    }
  }

  const rows: VendorRow[] = [...stats.values()]
    .map(({ samples, conversationIds, ...row }) => ({
      ...row,
      conversations: conversationIds.size,
      avgResponseMinutes: average(samples),
      conversionRate: row.won + row.lost > 0 ? Math.round((row.won / (row.won + row.lost)) * 100) : null,
    }))
    // Quem não fez nada no período (ex.: dono da conta que só administra)
    // não entra no ranking — só polui a comparação.
    .filter((row) => row.conversations > 0 || row.won > 0 || row.lost > 0)
    .sort(
      (a, b) =>
        b.won - a.won ||
        b.wonValueCents - a.wonValueCents ||
        b.conversations - a.conversations ||
        b.messagesSent - a.messagesSent,
    );

  return { rows, teamAvgResponseMinutes: average(teamSamples) };
}
