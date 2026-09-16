import { z } from "zod";

export const createTagSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome à tag.").max(40),
  color: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "Cor precisa estar em hexadecimal, ex.: #71717a.")
    .optional()
    .default("#71717a"),
});
