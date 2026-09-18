import { z } from "zod";

export const connectChannelSchema = z.object({
  wabaId: z.string().trim().min(1, "Informe o WABA ID."),
  phoneNumberId: z.string().trim().min(1, "Informe o Phone Number ID."),
  accessToken: z.string().trim().min(20, "Token de acesso inválido."),
});
