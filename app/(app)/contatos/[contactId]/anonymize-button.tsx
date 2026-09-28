"use client";

import { useActionState, useState } from "react";
import { anonymizeContact, type LgpdActionState } from "@/lib/actions/lgpd";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function AnonymizeButton({ contactId }: { contactId: string }) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [state, formAction, isPending] = useActionState<LgpdActionState, FormData>(
    async (prevState, formData) => {
      const result = await anonymizeContact(prevState, formData);
      if (result?.success) setOpen(false);
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={(value) => { setOpen(value); setConfirmText(""); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive">
          Anonimizar (LGPD)
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Anonimizar este contato?</DialogTitle>
          <DialogDescription>
            Use quando o cliente pedir pra ter os dados apagados. Nome, telefone, e-mail e o texto de
            todas as mensagens são apagados de vez — <strong>não dá pra desfazer</strong>. Os negócios
            (leads, valores, etapas) continuam nos relatórios, sem identificar a pessoa.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="contactId" value={contactId} />
          <label className="flex flex-col gap-1 text-sm">
            Digite <strong>ANONIMIZAR</strong> pra confirmar
            <input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="h-9 rounded-md border bg-transparent px-2"
              autoComplete="off"
            />
          </label>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending || confirmText !== "ANONIMIZAR"}>
              {isPending ? "Anonimizando..." : "Anonimizar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
