"use client";

import { useActionState } from "react";
import { cancelInvite, type CancelInviteState } from "@/lib/actions/invites";
import { Button } from "@/components/ui/button";

export function CancelInviteButton({ inviteId }: { inviteId: string }) {
  const [state, formAction, isPending] = useActionState<CancelInviteState, FormData>(cancelInvite, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="inviteId" value={inviteId} />
      {state?.error && <span className="text-xs text-destructive">{state.error}</span>}
      <Button type="submit" variant="ghost" size="sm" disabled={isPending} className="text-destructive">
        {isPending ? "Cancelando..." : "Cancelar"}
      </Button>
    </form>
  );
}
