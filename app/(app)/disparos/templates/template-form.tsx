"use client";

import { useActionState, useState } from "react";
import { createTemplate, type TemplateActionState } from "@/lib/actions/templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function TemplateForm({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<TemplateActionState, FormData>(
    createTemplate,
    null,
  );

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (!state?.error) setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Novo template</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Nome técnico</Label>
            <Input id="name" name="name" placeholder="promocao_setembro" required />
            <p className="text-xs text-muted-foreground">
              Só letras minúsculas, números e _ — a Meta usa isso como identificador, não aparece
              pro cliente.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="language">Idioma</Label>
              <select id="language" name="language" defaultValue="pt_BR" className="h-9 rounded-md border bg-transparent px-3 text-sm">
                <option value="pt_BR">Português (Brasil)</option>
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="category">Categoria</Label>
              <select id="category" name="category" defaultValue="MARKETING" className="h-9 rounded-md border bg-transparent px-3 text-sm">
                <option value="MARKETING">Marketing</option>
                <option value="UTILITY">Utilidade</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="bodyText">Texto</Label>
            <Textarea
              id="bodyText"
              name="bodyText"
              placeholder="Olá {{1}}, temos uma condição especial em setembro para você conhecer o novo Kardian!"
              required
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" name="hasVariable" />
              O texto usa {"{{1}}"} para o nome do contato
            </label>
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Enviando para a Meta..." : "Enviar para aprovação"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
