import { z } from "zod";

export const createInviteSchema = z.object({
  email: z.email("E-mail inválido."),
  role: z.enum(["admin", "manager", "agent"], {
    error: "Papel inválido.",
  }),
});

export const acceptInviteSchema = z.object({
  token: z.string().min(1, "Convite inválido."),
});
