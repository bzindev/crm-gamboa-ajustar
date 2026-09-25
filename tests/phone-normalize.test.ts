import { describe, expect, it } from "vitest";
import { normalizeBrazilianPhone, normalizeContactPhone } from "@/lib/crm/phone-normalize";
import { contactSchema } from "@/lib/validation/contacts";

describe("normalizeBrazilianPhone", () => {
  it.each([
    ["(11) 99999-9999", "+5511999999999"],
    ["11 9999-9999", "+5511999999999"],
    ["+55 (11) 99999-9999", "+5511999999999"],
    ["5511999999999", "+5511999999999"],
    ["+5511999999999", "+5511999999999"],
    // DDD 55 (RS) sem DDI não pode ser confundido com o código do Brasil.
    ["(55) 99999-9999", "+5555999999999"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeBrazilianPhone(raw)).toEqual({ phone: expected });
  });

  it.each(["9999-9999", "123", ""])("rejeita %j", (raw) => {
    expect(normalizeBrazilianPhone(raw).error).toBeTruthy();
  });
});

describe("normalizeContactPhone", () => {
  it("aceita número estrangeiro digitado com +", () => {
    expect(normalizeContactPhone("+1 (415) 555-0123")).toEqual({ phone: "+14155550123" });
  });

  it("usa a regra brasileira quando não tem + de outro país", () => {
    expect(normalizeContactPhone("(21) 98888-7777")).toEqual({ phone: "+5521988887777" });
  });

  it("rejeita internacional curto demais", () => {
    expect(normalizeContactPhone("+1 12").error).toBeTruthy();
  });
});

describe("contactSchema", () => {
  it("devolve o telefone já normalizado — é isso que faz a trava de duplicidade funcionar", () => {
    const a = contactSchema.parse({ name: "Ana", phone_e164: "(11) 99999-9999" });
    const b = contactSchema.parse({ name: "Ana", phone_e164: "+5511999999999" });
    expect(a.phone_e164).toBe("+5511999999999");
    expect(a.phone_e164).toBe(b.phone_e164);
  });

  it("mostra mensagem amigável pra telefone sem DDD", () => {
    const result = contactSchema.safeParse({ name: "Ana", phone_e164: "9999-9999" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/DDD/);
  });
});
