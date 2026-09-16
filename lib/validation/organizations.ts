import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2, "Nome muito curto.").max(80, "Nome muito longo."),
});
