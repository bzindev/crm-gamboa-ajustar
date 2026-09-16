import { z } from "zod";

export const vocabularySchema = z.object({
  lead_singular: z.string().trim().min(1).max(40),
  lead_plural: z.string().trim().min(1).max(40),
  won_label: z.string().trim().min(1).max(40),
  lost_label: z.string().trim().min(1).max(40),
});

export type Vocabulary = z.infer<typeof vocabularySchema>;

export const DEFAULT_VOCABULARY: Vocabulary = {
  lead_singular: "Lead",
  lead_plural: "Leads",
  won_label: "Ganho",
  lost_label: "Perdido",
};

export const createStageSchema = z.object({
  pipelineId: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome à etapa.").max(60),
});

export const renameStageSchema = z.object({
  stageId: z.string().uuid(),
  name: z.string().trim().min(1, "Dê um nome à etapa.").max(60),
});

export const deleteStageSchema = z.object({
  stageId: z.string().uuid(),
});
