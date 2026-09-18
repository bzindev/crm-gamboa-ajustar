import { z } from "zod";

const uuid = z.string().uuid();
const optionalUuid = z.union([uuid, z.literal("")]).optional();
const temperature = z.enum(["cold", "warm", "hot"]);

const commercialFields = {
  vehicleInterest: z.string().trim().max(160).optional(),
  temperature: temperature.optional(),
  origin: z.string().trim().max(80).optional(),
  campaign: z.string().trim().max(80).optional(),
  teamId: optionalUuid,
};

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
    ...commercialFields,
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
    ...commercialFields,
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

export const TEMPERATURE_LABELS: Record<z.infer<typeof temperature>, string> = {
  cold: "Frio",
  warm: "Morno",
  hot: "Quente",
};
