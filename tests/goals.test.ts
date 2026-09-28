import { describe, expect, it } from "vitest";
import { computeGoalProgress, monthKey } from "@/lib/crm/goals";

describe("monthKey", () => {
  it("usa o fuso de São Paulo: 22h do dia 30 ainda é o mês corrente", () => {
    // 01/10 01:00 UTC = 30/09 22:00 em São Paulo
    expect(monthKey("2026-10-01T01:00:00Z")).toBe("2026-09");
    expect(monthKey("2026-10-01T04:00:00Z")).toBe("2026-10");
  });
});

describe("computeGoalProgress", () => {
  const names = new Map([
    ["ana", "Ana"],
    ["bruno", "Bruno"],
  ]);
  const leads = [
    { owner_id: "ana", status: "won", value_cents: 100_00, updated_at: "2026-09-10T12:00:00Z" },
    { owner_id: "ana", status: "won", value_cents: 200_00, updated_at: "2026-09-11T12:00:00Z" },
    { owner_id: null, status: "won", value_cents: 50_00, updated_at: "2026-09-12T12:00:00Z" },
    { owner_id: "bruno", status: "lost", value_cents: 999_00, updated_at: "2026-09-12T12:00:00Z" },
    { owner_id: "bruno", status: "won", value_cents: 999_00, updated_at: "2026-08-30T12:00:00Z" },
    { owner_id: "bruno", status: "open", value_cents: 999_00, updated_at: "2026-09-12T12:00:00Z" },
  ];

  it("equipe conta toda venda do mês; vendedor só as dele", () => {
    const progress = computeGoalProgress(
      [
        { id: "g-bruno", user_id: "bruno", target_won: 2, target_value_cents: null },
        { id: "g-ana", user_id: "ana", target_won: 4, target_value_cents: 600_00 },
        { id: "g-team", user_id: null, target_won: 10, target_value_cents: null },
      ],
      leads,
      "2026-09",
      names,
    );

    expect(progress.map((p) => p.name)).toEqual(["Equipe inteira", "Ana", "Bruno"]);
    expect(progress[0]).toMatchObject({ won: 3, wonPct: 30, wonValueCents: 350_00, valuePct: null });
    expect(progress[1]).toMatchObject({ won: 2, wonPct: 50, wonValueCents: 300_00, valuePct: 50 });
    expect(progress[2]).toMatchObject({ won: 0, wonPct: 0 });
  });

  it("pode passar de 100%", () => {
    const [p] = computeGoalProgress([{ id: "g", user_id: "ana", target_won: 1, target_value_cents: null }], leads, "2026-09", names);
    expect(p.wonPct).toBe(200);
  });
});
