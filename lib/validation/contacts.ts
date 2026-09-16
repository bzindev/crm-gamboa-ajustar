import { z } from "zod";

// E.164: + seguido de 8 a 15 dígitos (padrão internacional de telefone).
const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  phone_e164: z
    .string()
    .trim()
    .regex(E164_REGEX, "Telefone precisa estar no formato internacional, ex.: +5511999999999."),
});

export type ContactInput = z.infer<typeof contactSchema>;
