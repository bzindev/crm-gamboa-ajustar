"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { createContact, updateContact, type ContactActionState } from "@/lib/actions/contacts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

type Contact = { id: string; name: string; phone_e164: string; email?: string | null; opted_in?: boolean };

export function ContactDialog({
  contact,
  trigger,
}: {
  contact?: Contact;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const action = contact ? updateContact : createContact;
  const [state, formAction, isPending] = useActionState<ContactActionState, FormData>(
    action,
    null,
  );

  // Fecha o dialog assim que a action devolver { success: true } — ajuste
  // de estado durante o render (padrão recomendado pelo React em vez de
  // useEffect) comparando com o resultado do render anterior.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{contact ? "Editar contato" : "Novo contato"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {contact && <input type="hidden" name="id" value={contact.id} />}
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Nome</Label>
            <Input id="name" name="name" defaultValue={contact?.name} required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="phone_e164">Telefone</Label>
            <Input
              id="phone_e164"
              name="phone_e164"
              placeholder="(11) 99999-9999"
              defaultValue={contact?.phone_e164}
              required
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">E-mail (opcional)</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="cliente@email.com"
              defaultValue={contact?.email ?? ""}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="optedIn" defaultChecked={contact?.opted_in} />
            Aceita receber mensagens em massa (marketing)
          </label>
          {state?.error && (
            <div className="flex flex-col gap-1 rounded-md border border-destructive/40 bg-destructive/5 p-2 text-sm">
              <p className="text-destructive">{state.error}</p>
              {state.duplicate && (
                <Link
                  href={`/contatos/${state.duplicate.id}`}
                  onClick={() => setOpen(false)}
                  className="w-fit text-xs font-medium text-primary hover:underline"
                >
                  Abrir contato existente
                </Link>
              )}
            </div>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
