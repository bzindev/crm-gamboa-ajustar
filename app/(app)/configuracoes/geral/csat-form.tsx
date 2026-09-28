"use client";

import { useActionState } from "react";
import { updateCsatSettings, type CsatActionState } from "@/lib/actions/csat";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function CsatForm({ enabled, message }: { enabled: boolean; message: string }) {
  const [state, formAction, isPending] = useActionState<CsatActionState, FormData>(updateCsatSettings, null);

  return (
    <form action={formAction} className="flex max-w-xl flex-col gap-3">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={enabled} />
        Enviar pesquisa quando a conversa for marcada como resolvida
      </label>
      <div className="flex flex-col gap-2">
        <Label htmlFor="csat-message">Pergunta enviada ao cliente</Label>
        <Textarea id="csat-message" name="message" rows={3} defaultValue={message} required maxLength={600} />
        <p className="text-xs text-muted-foreground">
          Peça pra responder só com um número de 1 a 5 — é o que o sistema reconhece como nota. Só é
          enviada se o cliente falou nas últimas 24h (regra da Meta pra mensagem livre).
        </p>
      </div>
      {state?.success && <p className="text-sm text-muted-foreground">Salvo.</p>}
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Salvando..." : "Salvar"}
      </Button>
    </form>
  );
}
