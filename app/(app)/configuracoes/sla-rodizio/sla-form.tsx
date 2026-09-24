"use client";

import { useActionState } from "react";
import { updateSlaMinutes, type ActionState } from "@/lib/actions/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SlaForm({ slaMinutes }: { slaMinutes: number }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateSlaMinutes,
    null,
  );

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="slaMinutes">Minutos sem resposta até alertar</Label>
        <Input
          id="slaMinutes"
          name="slaMinutes"
          type="number"
          min={1}
          max={180}
          defaultValue={slaMinutes}
          required
          className="w-28"
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "Salvando..." : "Salvar"}
      </Button>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
