import { z } from "zod";

export const PASSWORD_MIN = 10;

export const passwordField = z
  .string()
  .min(PASSWORD_MIN, `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`)
  .max(72, "Senha longa demais (máximo 72 caracteres).");

export const createUserSchema = z.object({
  fullName: z.string().trim().min(2, "Informe o nome.").max(80),
  email: z.email("E-mail inválido.").transform((e) => e.trim().toLowerCase()),
  role: z.enum(["admin", "manager", "agent"], { error: "Papel inválido." }),
  password: passwordField,
});

/** Senha em branco = manter a atual. */
export const updateMemberSchema = z.object({
  userId: z.string().uuid(),
  fullName: z.string().trim().min(2, "Informe o nome.").max(80),
  password: z.union([z.literal(""), passwordField]),
});
