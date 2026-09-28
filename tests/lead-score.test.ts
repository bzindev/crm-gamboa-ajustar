import { describe, expect, it } from "vitest";
import { scoreLead, openStageIndex, lastInboundByContact, type ScoreInput } from "@/lib/crm/lead-score";

const now = new Date("2026-09-28T12:00:00Z");
const base: ScoreInput = {
  status: "open",
  temperature: "cold",
  valueCents: null,
  stageIndex: 0,
  openStageCount: 6,
  daysInStage: 0,
  stageAlertDays: 3,
  lastInboundAt: null,
  now,
};

describe("scoreLead", () => {
  it("lead ganho/perdido não tem nota", () => {
    expect(scoreLead({ ...base, status: "won" })).toBeNull();
    expect(scoreLead({ ...base, status: "lost" })).toBeNull();
  });

  it("lead frio, parado no início e sem conversa fica com prioridade baixa", () => {
    expect(scoreLead(base)).toMatchObject({ score: 5, level: "baixa" });
  });

  it("quente, no fim do funil, com valor e cliente falando agora = prioridade alta", () => {
    const result = scoreLead({
      ...base,
      temperature: "hot",
      stageIndex: 5,
      valueCents: 8_000_000,
      lastInboundAt: "2026-09-28T09:00:00Z",
    });
    expect(result).toMatchObject({ score: 95, level: "alta" });
    expect(result!.reasons).toContain("cliente falou nas últimas 48h (+25)");
  });

  it("lead parado perde pontos, mais se passou do dobro do prazo", () => {
    const warm = { ...base, temperature: "warm" as const };
    expect(scoreLead({ ...warm, daysInStage: 3 })!.score).toBe(5);
    expect(scoreLead({ ...warm, daysInStage: 6 })!.score).toBe(0);
  });

  it("conversa na última semana vale menos que nas últimas 48h", () => {
    expect(scoreLead({ ...base, lastInboundAt: "2026-09-24T12:00:00Z" })!.score).toBe(17);
  });
});

describe("apoio", () => {
  it("ignora etapas finais ao numerar o funil", () => {
    const { indexById, count } = openStageIndex([
      { id: "venda", position: 7, is_won: true, is_lost: false },
      { id: "b", position: 2, is_won: false, is_lost: false },
      { id: "a", position: 1, is_won: false, is_lost: false },
      { id: "perdido", position: 8, is_won: false, is_lost: true },
    ]);
    expect(count).toBe(2);
    expect(indexById.get("a")).toBe(0);
    expect(indexById.get("b")).toBe(1);
    expect(indexById.has("venda")).toBe(false);
  });

  it("pega a mensagem mais recente entre várias conversas do mesmo contato", () => {
    const map = lastInboundByContact([
      { contact_id: "c1", last_inbound_at: "2026-09-01T00:00:00Z" },
      { contact_id: "c1", last_inbound_at: "2026-09-05T00:00:00Z" },
      { contact_id: "c2", last_inbound_at: null },
    ]);
    expect(map.get("c1")).toBe("2026-09-05T00:00:00Z");
    expect(map.has("c2")).toBe(false);
  });
});
