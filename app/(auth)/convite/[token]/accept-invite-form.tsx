"use client";

import { useActionState } from "react";
import { acceptInvite, type AcceptInviteState } from "@/lib/actions/invites";
import { Button } from "@/components/ui/button";

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState<AcceptInviteState, FormData>(
    acceptInvite,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={isPending}>
        {isPending ? "Aceitando..." : "Aceitar convite"}
      </Button>
    </form>
  );
}
