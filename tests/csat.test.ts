import { describe, expect, it } from "vitest";
import { parseCsatRating, summarizeCsat } from "@/lib/crm/csat";

describe("parseCsatRating", () => {
  it.each([
    ["5", 5],
    [" 4 ", 4],
    ["3!", 3],
    ["1.", 1],
    ["5️⃣", 5],
  ])("%j → %d", (text, rating) => {
    expect(parseCsatRating(text)).toBe(rating);
  });

  it.each(["0", "6", "10", "5 carros", "nota 5", "quero falar com alguém", "", null])("ignora %j", (text) => {
    expect(parseCsatRating(text)).toBeNull();
  });
});

describe("summarizeCsat", () => {
  const names = new Map([["ana", "Ana"], ["bruno", "Bruno"]]);
  const always = () => true;

  it("média, taxa de resposta, % satisfeitos e por vendedor", () => {
    const summary = summarizeCsat(
      [
        { agent_id: "ana", status: "answered", rating: 5, sent_at: "2026-09-01T00:00:00Z" },
        { agent_id: "ana", status: "answered", rating: 4, sent_at: "2026-09-02T00:00:00Z" },
        { agent_id: "bruno", status: "answered", rating: 2, sent_at: "2026-09-03T00:00:00Z" },
        { agent_id: "bruno", status: "sent", rating: null, sent_at: "2026-09-04T00:00:00Z" },
        { agent_id: "bruno", status: "skipped", rating: null, sent_at: null },
        { agent_id: "bruno", status: "failed", rating: null, sent_at: null },
      ],
      names,
      always,
    );
    expect(summary).toMatchObject({ sent: 4, answered: 3, responseRate: 75, average: 3.7, satisfiedPct: 67 });
    expect(summary.byAgent).toEqual([
      { agentId: "ana", name: "Ana", answered: 2, average: 4.5 },
      { agentId: "bruno", name: "Bruno", answered: 1, average: 2 },
    ]);
  });

  it("sem pesquisa no período, tudo vazio", () => {
    expect(summarizeCsat([], names, always)).toMatchObject({ sent: 0, average: null, responseRate: null, byAgent: [] });
  });
});
