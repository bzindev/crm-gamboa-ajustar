"use client";

import { useActionState } from "react";
import { connectChannel, type ChannelActionState } from "@/lib/actions/channels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ChannelForm() {
  const [state, formAction, isPending] = useActionState<ChannelActionState, FormData>(
    connectChannel,
    null,
  );

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="wabaId">WABA ID</Label>
        <Input id="wabaId" name="wabaId" placeholder="Id da WhatsApp Business Account" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="phoneNumberId">Phone Number ID</Label>
        <Input id="phoneNumberId" name="phoneNumberId" placeholder="Id do número no Meta" required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="accessToken">Token de acesso permanente</Label>
        <Input id="accessToken" name="accessToken" type="password" placeholder="EAAG..." required />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Conectando..." : "Conectar"}
      </Button>
    </form>
  );
}
