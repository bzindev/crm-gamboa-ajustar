import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(80, "Nome muito longo."),
});

export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(80, "Nome muito longo."),
});

export const updateStageAlertDaysSchema = z.object({
  stageAlertDays: z.coerce.number().int().min(1, "Mínimo de 1 dia.").max(90, "Máximo de 90 dias."),
});
