import { z } from "zod";

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal("")]).optional();

export const createLeadSchema = z
  .object({
    title: z.string().trim().min(1, "Dê um título ao lead.").max(160),
    stageId: uuid,
    valueReais: z.coerce.number().min(0).optional(),
    ownerId: optionalUuid,
    contactId: optionalUuid,
    newContactName: z.string().trim().optional(),
    newContactPhone: z.string().trim().optional(),
    tagIds: z.array(uuid).optional(),
  })
  .refine(
    (data) => Boolean(data.contactId) || Boolean(data.newContactName && data.newContactPhone),
    {
      message: "Escolha um contato existente ou preencha nome e telefone para criar um novo.",
      path: ["contactId"],
    },
  );

export const updateLeadSchema = z
  .object({
    id: uuid,
    title: z.string().trim().min(1, "Dê um título ao lead.").max(160),
    stageId: uuid,
    valueReais: z.coerce.number().min(0).optional(),
    ownerId: optionalUuid,
    tagIds: z.array(uuid).optional(),
    status: z.enum(["open", "won", "lost"]).optional(),
    lostReason: z.string().trim().max(300).optional(),
  })
  .refine((data) => data.status !== "lost" || Boolean(data.lostReason), {
    message: "Conte rapidamente o motivo da perda — ajuda a entender o funil depois.",
    path: ["lostReason"],
  });

export const moveLeadSchema = z.object({
  leadId: uuid,
  stageId: uuid,
  position: z.coerce.number(),
});
