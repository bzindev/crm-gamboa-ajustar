import { z } from "zod";

export const createTeamSchema = z.object({
  name: z.string().trim().min(1, "Dê um nome ao setor.").max(60),
});

export const toggleTeamMemberSchema = z.object({
  teamId: z.string().uuid(),
  userId: z.string().uuid(),
  action: z.enum(["add", "remove"]),
});
