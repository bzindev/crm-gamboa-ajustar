import { z } from "zod";
import { normalizeContactPhone } from "@/lib/crm/phone-normalize";

// Aceita formato brasileiro comum e devolve sempre E.164 — sem isso, o
// mesmo número digitado de dois jeitos passava pela trava de duplicidade
// (unique(org_id, phone_e164) compara o texto exato).
export const phoneField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const result = normalizeContactPhone(value);
    if (result.error !== undefined) {
      ctx.addIssue({ code: "custom", message: result.error });
      return z.NEVER;
    }
    return result.phone;
  });

export const contactSchema = z.object({
  name: z.string().trim().min(1, "Informe o nome.").max(120),
  phone_e164: phoneField,
  email: z.union([z.email("E-mail inválido."), z.literal("")]).optional(),
  optedIn: z.coerce.boolean().optional(),
});

export type ContactInput = z.infer<typeof contactSchema>;
