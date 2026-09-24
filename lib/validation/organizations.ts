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

export const updateSlaMinutesSchema = z.object({
  slaMinutes: z.coerce.number().int().min(1, "Mínimo de 1 minuto.").max(180, "Máximo de 180 minutos."),
});

export const updateReassignMinutesSchema = z.object({
  reassignMinutes: z.coerce.number().int().min(1, "Mínimo de 1 minuto.").max(120, "Máximo de 120 minutos."),
});

const timeRegex = /^([01]\d|2[0-3]):[0-5]\d$/;
const timeField = z.string().regex(timeRegex, "Use o formato HH:MM.");

export const updateBusinessHoursSchema = z
  .object({
    weekday_open: timeField,
    weekday_close: timeField,
    saturday_enabled: z.coerce.boolean().optional(),
    saturday_open: timeField,
    saturday_close: timeField,
  })
  .refine((data) => data.weekday_open < data.weekday_close, {
    message: "O horário de abertura precisa ser antes do de fechamento.",
    path: ["weekday_close"],
  });
