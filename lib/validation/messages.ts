import { z } from "zod";

export const sendMessageSchema = z.object({
  conversationId: z.string().uuid(),
  body: z.string().trim().min(1, "Escreva uma mensagem.").max(4096),
});

/**
 * Template aprovado enviado de dentro da conversa (o único jeito de falar
 * com o cliente fora da janela de 24h). A Meta recusa variável com quebra
 * de linha, tab ou mais de 4 espaços seguidos — barra aqui, com mensagem
 * clara, em vez de devolver o erro genérico dela.
 */
export const sendTemplateSchema = z.object({
  conversationId: z.string().uuid(),
  templateId: z.string().uuid(),
  variable: z
    .string()
    .trim()
    .max(200, "O texto da variável pode ter no máximo 200 caracteres.")
    .refine((v) => !/[\n\r\t]/.test(v), "O texto da variável não pode ter quebra de linha.")
    .refine((v) => !/ {5,}/.test(v), "O texto da variável não pode ter mais de 4 espaços seguidos.")
    .optional(),
});
