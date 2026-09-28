import { describe, expect, it } from "vitest";
import { buildContactTimeline, type TimelineSources } from "@/lib/crm/contact-timeline";

function sources(overrides: Partial<TimelineSources> = {}): TimelineSources {
  return {
    contact: { name: "Ana", created_at: "2026-09-01T10:00:00Z" },
    leads: [{ id: "lead-1", title: "Kwid Zen", created_at: "2026-09-02T10:00:00Z" }],
    messages: [],
    consents: [],
    audit: [],
    stageNames: new Map([
      ["s1", "Lead"],
      ["s2", "Em atendimento"],
    ]),
    userNames: new Map([["u1", "Bruno"]]),
    ...overrides,
  };
}

describe("buildContactTimeline", () => {
  it("junta tudo e ordena do mais recente pro mais antigo", () => {
    const events = buildContactTimeline(
      sources({
        messages: [
          { direction: "inbound", body: "Oi", created_at: "2026-09-03T10:00:00Z", sent_by: null },
          { direction: "outbound", body: "Olá!", created_at: "2026-09-03T10:05:00Z", sent_by: "u1" },
        ],
      }),
    );
    expect(events.map((e) => e.title)).toEqual([
      "Mensagem enviada",
      "Cliente enviou mensagem",
      "Lead criado: Kwid Zen",
      "Contato cadastrado",
    ]);
    expect(events[0].actor).toBe("Bruno");
  });

  it("traduz mudança de etapa com nomes e marca ganho/perdido", () => {
    const events = buildContactTimeline(
      sources({
        audit: [
          { action: "lead.stage_changed", resource_type: "leads", resource_id: "lead-1", actor_id: "u1", before: { stage_id: "s1" }, after: { stage_id: "s2" }, created_at: "2026-09-04T10:00:00Z" },
          { action: "lead.updated", resource_type: "leads", resource_id: "lead-1", actor_id: "u1", before: { stage_id: "s2", status: "open" }, after: { stage_id: "s2", status: "won" }, created_at: "2026-09-05T10:00:00Z" },
        ],
      }),
    );
    expect(events[0].title).toBe("Kwid Zen marcado como ganho");
    expect(events[1].title).toBe("Kwid Zen: Lead → Em atendimento");
  });

  it("mostra quem recebeu numa transferência e 'Sistema' pra ação automática", () => {
    const events = buildContactTimeline(
      sources({
        audit: [
          { action: "conversation.transferred", resource_type: "conversations", resource_id: "c1", actor_id: "u1", before: {}, after: { assigned_to: "u1" }, created_at: "2026-09-06T10:00:00Z" },
          { action: "conversation.auto_assigned", resource_type: "conversations", resource_id: "c1", actor_id: null, before: null, after: { assigned_to: "u9" }, created_at: "2026-09-05T10:00:00Z" },
        ],
      }),
    );
    expect(events[0].title).toBe("Conversa transferida para Bruno");
    expect(events[1].title).toBe("Conversa distribuída pelo rodízio para Usuário removido");
  });

  it("encurta mensagem longa", () => {
    const events = buildContactTimeline(
      sources({ messages: [{ direction: "inbound", body: "a".repeat(300), created_at: "2026-09-09T10:00:00Z", sent_by: null }] }),
    );
    expect(events[0].detail?.length).toBeLessThanOrEqual(141);
  });
});
