import { z } from "zod";

export const createCampaignSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome à campanha.").max(120),
  templateId: z.string().uuid("Selecione um template."),
  contactIds: z.array(z.string().uuid()).min(1, "Selecione pelo menos um contato."),
});
