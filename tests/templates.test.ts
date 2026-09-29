import { describe, expect, it } from "vitest";
import { createTemplateSchema, toTemplateName } from "@/lib/validation/templates";

describe("toTemplateName", () => {
  it.each([
    ["Promoção Setembro!", "promocao_setembro"],
    ["promocao_setembro", "promocao_setembro"],
    ["  Kardian   2026 ", "kardian_2026"],
    ["Revisão -- Pós-Venda", "revisao_pos_venda"],
  ])("%j → %j", (raw, expected) => {
    expect(toTemplateName(raw, { final: true })).toBe(expected);
  });

  it("enquanto digita, deixa o _ do fim (senão não dá pra digitar o separador)", () => {
    expect(toTemplateName("promocao ")).toBe("promocao_");
  });
});

describe("createTemplateSchema", () => {
  const base = { language: "pt_BR", category: "MARKETING" };

  it("aceita o exemplo da tela", () => {
    const parsed = createTemplateSchema.safeParse({
      ...base,
      name: "Promoção Setembro",
      bodyText: "Olá {{1}}, temos uma condição especial em setembro para você conhecer o novo Kardian!",
    });
    expect(parsed.success).toBe(true);
    expect(parsed.data?.name).toBe("promocao_setembro");
  });

  it("recusa nome vazio", () => {
    expect(createTemplateSchema.safeParse({ ...base, name: "!!!", bodyText: "Olá" }).success).toBe(false);
  });

  it.each(["{{1}}, tudo bem?", "Obrigado {{1}}", "Olá {{2}}, tudo bem?"])("recusa variável que a Meta não aceita: %j", (bodyText) => {
    expect(createTemplateSchema.safeParse({ ...base, name: "x", bodyText }).success).toBe(false);
  });
});
