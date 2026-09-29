import { z } from "zod";

// Meta exige nome técnico: minúsculas, números e underscore só.
const TEMPLATE_NAME_REGEX = /^[a-z0-9_]{1,512}$/;

/**
 * "Promoção Setembro!" → "promocao_setembro". Usado enquanto a pessoa
 * digita (sem tirar o "_" do fim, senão não dá pra digitar o separador) e
 * de novo no servidor com `final: true`.
 */
export function toTemplateName(raw: string, options: { final?: boolean } = {}): string {
  const name = raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 512);
  return options.final ? name.replace(/^_+|_+$/g, "") : name.replace(/^_+/, "");
}

/** O texto usa a variável do nome? (só {{1}} é suportado) */
export function bodyHasVariable(bodyText: string): boolean {
  return bodyText.includes("{{1}}");
}

export const createTemplateSchema = z
  .object({
    name: z
      .string()
      .transform((value) => toTemplateName(value, { final: true }))
      .pipe(z.string().regex(TEMPLATE_NAME_REGEX, "Dê um nome técnico ao template (ex.: promocao_setembro).")),
    language: z.string().trim().min(2).max(10),
    category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
    bodyText: z.string().trim().min(1, "Escreva o texto do template.").max(1024, "Máximo de 1024 caracteres."),
  })
  // Regras da própria Meta — melhor avisar aqui do que esperar a recusa.
  .superRefine((data, ctx) => {
    const variables = data.bodyText.match(/\{\{\s*\d+\s*\}\}/g) ?? [];
    if (variables.some((v) => v.replace(/\s/g, "") !== "{{1}}")) {
      ctx.addIssue({ code: "custom", path: ["bodyText"], message: "Só dá pra usar {{1}} (o nome do contato) — tire as outras variáveis." });
    }
    if (/^\{\{1\}\}/.test(data.bodyText) || /\{\{1\}\}$/.test(data.bodyText)) {
      ctx.addIssue({
        code: "custom",
        path: ["bodyText"],
        message: "A Meta não aceita o texto começando ou terminando com {{1}} — coloque uma palavra antes/depois (ex.: \"Olá {{1}}, …\").",
      });
    }
  });
