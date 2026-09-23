import { z } from "zod";

// Meta exige nome técnico: minúsculas, números e underscore só.
const TEMPLATE_NAME_REGEX = /^[a-z0-9_]{1,512}$/;

export const createTemplateSchema = z.object({
  name: z.string().trim().regex(TEMPLATE_NAME_REGEX, "Use só letras minúsculas, números e _ (sem espaço)."),
  language: z.string().trim().min(2).max(10),
  category: z.enum(["MARKETING", "UTILITY", "AUTHENTICATION"]),
  bodyText: z.string().trim().min(1, "Escreva o texto do template.").max(1024),
  // v1 só suporta 0 ou 1 variável no corpo (preenchida com o nome do
  // contato) — nada de header/footer/botão dinâmico ainda.
  hasVariable: z.coerce.boolean().optional(),
});
