import { describe, expect, it } from "vitest";
import { fillQuickReply } from "@/lib/validation/quick-replies";

describe("fillQuickReply", () => {
  it("troca {nome} pelo primeiro nome", () => {
    expect(fillQuickReply("Olá, {nome}! Tudo bem?", "Maria Souza")).toBe("Olá, Maria! Tudo bem?");
  });

  it("aceita {NOME} em maiúsculas", () => {
    expect(fillQuickReply("Oi {NOME}", "João")).toBe("Oi João");
  });

  it("sem nome, some com a variável sem deixar espaço sobrando antes da pontuação", () => {
    expect(fillQuickReply("Olá, {nome}! Tudo bem?", null)).toBe("Olá! Tudo bem?");
    expect(fillQuickReply("Oi {nome}, tudo bem?", null)).toBe("Oi, tudo bem?");
    expect(fillQuickReply("{nome}, pra eu fazer a simulação", "")).toBe("Pra eu fazer a simulação");
  });
});
