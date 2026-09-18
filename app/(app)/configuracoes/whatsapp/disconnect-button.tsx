"use client";

import { useActionState } from "react";
import { disconnectChannel, type ChannelActionState } from "@/lib/actions/channels";
import { Button } from "@/components/ui/button";

export function DisconnectButton({ channelId }: { channelId: string }) {
  const [state, formAction, isPending] = useActionState<ChannelActionState, FormData>(
    disconnectChannel,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="channelId" value={channelId} />
      <Button type="submit" variant="outline" disabled={isPending} className="w-fit">
        {isPending ? "Desconectando..." : "Desconectar"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
