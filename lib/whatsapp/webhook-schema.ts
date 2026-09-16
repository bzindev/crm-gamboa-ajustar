import { z } from "zod";

/**
 * Permissivo de propósito (.passthrough() nos objetos): a Meta pode
 * adicionar campo novo a qualquer momento, e a gente só usa um subconjunto
 * pequeno do payload. Falhar o parse inteiro por um campo desconhecido
 * derrubaria mensagens boas — só validamos que o que a gente precisa está
 * no formato esperado.
 */

const messageSchema = z
  .object({
    from: z.string(),
    id: z.string(),
    timestamp: z.string(),
    type: z.string(),
    text: z.object({ body: z.string() }).passthrough().optional(),
  })
  .passthrough();

const statusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string(),
    recipient_id: z.string().optional(),
  })
  .passthrough();

const contactSchema = z
  .object({
    wa_id: z.string(),
    profile: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

const changeValueSchema = z
  .object({
    messaging_product: z.literal("whatsapp"),
    metadata: z
      .object({
        display_phone_number: z.string().optional(),
        phone_number_id: z.string(),
      })
      .passthrough(),
    contacts: z.array(contactSchema).optional(),
    messages: z.array(messageSchema).optional(),
    statuses: z.array(statusSchema).optional(),
  })
  .passthrough();

const changeSchema = z
  .object({
    field: z.string(),
    value: changeValueSchema,
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.string(),
    changes: z.array(changeSchema),
  })
  .passthrough();

export const webhookPayloadSchema = z
  .object({
    object: z.string(),
    entry: z.array(entrySchema),
  })
  .passthrough();

export type WebhookPayload = z.infer<typeof webhookPayloadSchema>;
export type WebhookMessage = z.infer<typeof messageSchema>;
export type WebhookStatus = z.infer<typeof statusSchema>;
export type WebhookContact = z.infer<typeof contactSchema>;
