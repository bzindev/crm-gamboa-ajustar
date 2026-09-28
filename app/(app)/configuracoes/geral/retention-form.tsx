"use client";

import { useActionState } from "react";
import { updateRetention, type LgpdActionState } from "@/lib/actions/lgpd";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RetentionForm({ retentionMonths }: { retentionMonths: number | null }) {
  const [state, formAction, isPending] = useActionState<LgpdActionState, FormData>(updateRetention, null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="retentionMonths">Meses sem atividade até anonimizar</Label>
          <Input
            id="retentionMonths"
            name="retentionMonths"
            type="number"
            min={6}
            max={120}
            defaultValue={retentionMonths ?? ""}
            placeholder="desligado"
            className="w-36"
          />
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Salvando..." : "Salvar"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Deixe em branco pra desligar. Quando ligado, contatos sem nenhuma mensagem, negócio ou alteração
        nesse prazo (e sem lead em aberto) são anonimizados automaticamente — de forma irreversível.
      </p>
      {state?.success && <p className="text-sm text-muted-foreground">Salvo.</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
