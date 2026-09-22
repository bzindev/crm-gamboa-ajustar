"use client";

import { useActionState } from "react";
import { claimConversation, type ConversationActionState } from "@/lib/actions/conversations";
import { Button } from "@/components/ui/button";

export function ClaimButton({ conversationId }: { conversationId: string }) {
  const [state, formAction, isPending] = useActionState<ConversationActionState, FormData>(
    claimConversation,
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <Button type="submit" size="sm" variant="outline" disabled={isPending}>
        {isPending ? "Assumindo..." : "Assumir conversa"}
      </Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
