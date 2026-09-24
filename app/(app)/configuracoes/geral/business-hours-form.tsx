"use client";

import { useActionState, useState } from "react";
import { updateBusinessHours, type ActionState } from "@/lib/actions/organizations";
import type { BusinessHours } from "@/lib/crm/business-hours";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function BusinessHoursForm({ hours }: { hours: BusinessHours }) {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    updateBusinessHours,
    null,
  );
  const [saturdayEnabled, setSaturdayEnabled] = useState(hours.saturday_enabled);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-4">
      <div>
        <p className="mb-2 text-sm font-medium">Segunda a sexta</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="weekday_open">Abre</Label>
            <Input id="weekday_open" name="weekday_open" type="time" defaultValue={hours.weekday_open} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="weekday_close">Fecha</Label>
            <Input id="weekday_close" name="weekday_close" type="time" defaultValue={hours.weekday_close} required />
          </div>
        </div>
      </div>

      <div>
        <label className="mb-2 flex items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            name="saturday_enabled"
            checked={saturdayEnabled}
            onChange={(e) => setSaturdayEnabled(e.target.checked)}
          />
          Abre aos sábados
        </label>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="saturday_open">Abre</Label>
            <Input
              id="saturday_open"
              name="saturday_open"
              type="time"
              defaultValue={hours.saturday_open}
              disabled={!saturdayEnabled}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="saturday_close">Fecha</Label>
            <Input
              id="saturday_close"
              name="saturday_close"
              type="time"
              defaultValue={hours.saturday_close}
              disabled={!saturdayEnabled}
              required
            />
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Domingo sempre fechado. Usado pelo rodízio automático de vendedores: lead ou conversa que
        chegar fora do horário fica sem dono, pra alguém pegar manualmente quando abrir.
      </p>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}
