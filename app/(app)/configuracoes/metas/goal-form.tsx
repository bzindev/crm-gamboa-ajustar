"use client";

import { useActionState } from "react";
import { saveGoal, type GoalActionState } from "@/lib/actions/goals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GoalForm({ members, defaultMonth }: { members: { id: string; name: string }[]; defaultMonth: string }) {
  const [state, formAction, isPending] = useActionState<GoalActionState, FormData>(saveGoal, null);

  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="userId">Para quem</Label>
        <select id="userId" name="userId" defaultValue="" className="h-9 rounded-md border bg-transparent px-2 text-sm">
          <option value="">Equipe inteira</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="month">Mês</Label>
        <Input id="month" name="month" type="month" defaultValue={defaultMonth} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="targetWon">Meta de vendas (quantidade)</Label>
        <Input id="targetWon" name="targetWon" type="number" min={1} required placeholder="Ex.: 10" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="targetValueReais">Meta de valor em R$ (opcional)</Label>
        <Input id="targetValueReais" name="targetValueReais" type="number" min={1} step="0.01" placeholder="Ex.: 800000" />
      </div>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando..." : "Salvar meta"}
        </Button>
        {state?.success && <span className="text-sm text-muted-foreground">Meta salva.</span>}
        {state?.error && <span className="text-sm text-destructive">{state.error}</span>}
      </div>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Salvar de novo para a mesma pessoa e o mesmo mês atualiza a meta existente.
      </p>
    </form>
  );
}
