"use client";

import { useActionState, useRef } from "react";
import { importContacts, type ImportContactsState } from "@/lib/actions/contacts-import";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

export function ImportDialog({ trigger }: { trigger: React.ReactNode }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState<ImportContactsState, FormData>(
    importContacts,
    null,
  );

  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
        </DialogHeader>
        <form ref={formRef} action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="file">Arquivo CSV</Label>
            <input
              id="file"
              name="file"
              type="file"
              accept=".csv,text/csv"
              required
              className="text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
            />
            <p className="text-xs text-muted-foreground">
              Precisa ter colunas de nome e telefone (ex.: &quot;Nome&quot;, &quot;Telefone&quot;) —
              a primeira linha é o cabeçalho. E-mail é opcional. Contato com telefone já cadastrado
              é atualizado, não duplicado. Importar não marca opt-in — isso é feito à parte, por
              contato.
            </p>
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          {state?.summary && (
            <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <div className="flex gap-2">
                <Badge variant="default">{state.summary.created} criados</Badge>
                <Badge variant="secondary">{state.summary.updated} atualizados</Badge>
                {state.summary.skipped > 0 && (
                  <Badge variant="destructive">{state.summary.skipped} com erro</Badge>
                )}
              </div>
              {state.summary.errors.length > 0 && (
                <ul className="max-h-40 list-disc overflow-y-auto pl-4 text-xs text-muted-foreground">
                  {state.summary.errors.map((e, i) => (
                    <li key={i}>
                      Linha {e.line}: {e.reason}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <Button type="submit" disabled={isPending} className="w-fit">
            {isPending ? "Importando..." : "Importar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
