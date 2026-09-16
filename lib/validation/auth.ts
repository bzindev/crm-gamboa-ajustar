import { z } from "zod";

export const signUpSchema = z.object({
  name: z.string().trim().min(2, "Informe seu nome."),
  email: z.email("E-mail inválido."),
  password: z.string().min(8, "A senha precisa ter pelo menos 8 caracteres."),
});

export const signInSchema = z.object({
  email: z.email("E-mail inválido."),
  password: z.string().min(1, "Informe sua senha."),
});
