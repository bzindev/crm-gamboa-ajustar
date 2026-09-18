import { z } from "zod";

export const updateConversationStatusSchema = z.object({
  conversationId: z.string().uuid(),
  status: z.enum(["open", "pending", "resolved", "closed"]),
});
