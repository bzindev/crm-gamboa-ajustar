"use client";

import { useActionState } from "react";
import { updateStageAlertDays, type ActionState } from "@/lib/actions/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function StageAlertForm({ stageAlertDays }: { stageAlertDays: number }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateStageAlertDays,
    null,
  );

  return (
    <form action={formAction} className="flex items-end gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="stageAlertDays">Dias parado até alertar</Label>
        <Input
          id="stageAlertDays"
          name="stageAlertDays"
          type="number"
          min={1}
          max={90}
          defaultValue={stageAlertDays}
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
