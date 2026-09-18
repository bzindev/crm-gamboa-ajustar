"use client";

import { useActionState } from "react";
import { updateOrganization, type ActionState } from "@/lib/actions/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GeneralForm({ orgName }: { orgName: string }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateOrganization,
    null,
  );

  return (
    <form action={formAction} className="flex max-w-sm flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="name">Nome da organização</Label>
        <Input id="name" name="name" defaultValue={orgName} required minLength={2} maxLength={80} />
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}
