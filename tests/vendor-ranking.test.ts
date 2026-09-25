import { describe, expect, it } from "vitest";
import { buildVendorRanking, type RankingMessage } from "@/lib/reports/vendor-ranking";

const members = [
  { userId: "ana", name: "Ana" },
  { userId: "bruno", name: "Bruno" },
  { userId: "dono", name: "Dono" },
];

function msg(
  conversation_id: string,
  direction: "inbound" | "outbound",
  minute: number,
  sent_by: string | null = null,
): RankingMessage {
  return {
    conversation_id,
    direction,
    created_at: new Date(Date.UTC(2026, 8, 1, 12, minute)).toISOString(),
    sent_by,
  };
}

const always = () => true;

describe("buildVendorRanking", () => {
  it("credita o tempo de resposta a quem respondeu, a partir da 1ª mensagem sem resposta", () => {
    const { rows, teamAvgResponseMinutes } = buildVendorRanking({
      messages: [
        msg("c1", "inbound", 0),
        msg("c1", "inbound", 3),
        msg("c1", "outbound", 10, "ana"),
        msg("c2", "inbound", 0),
        msg("c2", "outbound", 20, "bruno"),
      ],
      leads: [],
      members,
      isInPeriod: always,
    });

    const ana = rows.find((r) => r.userId === "ana")!;
    const bruno = rows.find((r) => r.userId === "bruno")!;
    expect(ana.avgResponseMinutes).toBe(10);
    expect(bruno.avgResponseMinutes).toBe(20);
    expect(teamAvgResponseMinutes).toBe(15);
  });

  it("ignora template do disparo em massa (sem sent_by) como resposta", () => {
    const { rows, teamAvgResponseMinutes } = buildVendorRanking({
      messages: [
        msg("c1", "inbound", 0),
        msg("c1", "outbound", 2, null),
        msg("c1", "outbound", 30, "ana"),
      ],
      leads: [],
      members,
      isInPeriod: always,
    });

    expect(rows.find((r) => r.userId === "ana")!.avgResponseMinutes).toBe(30);
    expect(teamAvgResponseMinutes).toBe(30);
  });

  it("conta conversas distintas e mensagens enviadas por vendedor", () => {
    const { rows } = buildVendorRanking({
      messages: [
        msg("c1", "outbound", 1, "ana"),
        msg("c1", "outbound", 2, "ana"),
        msg("c2", "outbound", 3, "ana"),
      ],
      leads: [],
      members,
      isInPeriod: always,
    });

    const ana = rows.find((r) => r.userId === "ana")!;
    expect(ana.conversations).toBe(2);
    expect(ana.messagesSent).toBe(3);
  });

  it("ordena por ganhos e calcula conversão só com leads fechados no período", () => {
    const inSeptember = (d: string) => d.startsWith("2026-09");
    const { rows } = buildVendorRanking({
      messages: [],
      leads: [
        { owner_id: "ana", status: "won", value_cents: 1000, updated_at: "2026-09-05T00:00:00Z" },
        { owner_id: "bruno", status: "won", value_cents: 500, updated_at: "2026-09-05T00:00:00Z" },
        { owner_id: "bruno", status: "won", value_cents: 500, updated_at: "2026-09-06T00:00:00Z" },
        { owner_id: "bruno", status: "lost", value_cents: 0, updated_at: "2026-09-07T00:00:00Z" },
        { owner_id: "ana", status: "won", value_cents: 9999, updated_at: "2026-08-01T00:00:00Z" },
        { owner_id: "ana", status: "open", value_cents: 100, updated_at: "2026-09-08T00:00:00Z" },
      ],
      members,
      isInPeriod: inSeptember,
    });

    expect(rows.map((r) => r.userId)).toEqual(["bruno", "ana"]);
    expect(rows[0]).toMatchObject({ won: 2, lost: 1, conversionRate: 67, wonValueCents: 1000 });
    expect(rows[1]).toMatchObject({ won: 1, lost: 0, conversionRate: 100, wonValueCents: 1000 });
  });

  it("deixa de fora quem não teve atividade nenhuma no período", () => {
    const { rows } = buildVendorRanking({
      messages: [msg("c1", "outbound", 1, "ana")],
      leads: [],
      members,
      isInPeriod: always,
    });

    expect(rows.map((r) => r.userId)).toEqual(["ana"]);
  });
});
