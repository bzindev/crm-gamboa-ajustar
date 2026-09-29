"use client";

import { useActionState, useState } from "react";
import { createTemplate, type TemplateActionState } from "@/lib/actions/templates";
import { toTemplateName, bodyHasVariable } from "@/lib/validation/templates";
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
  // Campos controlados: com campo "solto", o React limpa o formulário depois
  // de enviar — e num erro a pessoa perdia tudo o que tinha digitado.
  const [name, setName] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [bodyText, setBodyText] = useState("");
  const [state, formAction, isPending] = useActionState<TemplateActionState, FormData>(
    createTemplate,
    null,
  );

  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (!state?.error) {
      setOpen(false);
      setName("");
      setBodyText("");
      setCategory("MARKETING");
    }
  }

  const hasVariable = bodyHasVariable(bodyText);

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
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(toTemplateName(e.target.value))}
              placeholder="ex.: promocao_setembro"
              required
            />
            <p className="text-xs text-muted-foreground">
              Pode digitar normalmente — vira o formato da Meta sozinho (minúsculas, sem acento, espaço
              vira _). Não aparece pro cliente.
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
              <select
                id="category"
                name="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              >
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
              value={bodyText}
              onChange={(e) => setBodyText(e.target.value)}
              placeholder="ex.: Olá {{1}}, temos uma condição especial em setembro para você conhecer o novo Kardian!"
              rows={4}
              maxLength={1024}
              required
            />
            <p className="text-xs text-muted-foreground">
              Escreva <code className="rounded bg-muted px-1">{"{{1}}"}</code> onde quiser o nome do
              cliente (não no começo nem no fim do texto — regra da Meta).
            </p>
            {bodyText.trim() && (
              <div className="rounded-md border bg-muted/40 p-2 text-sm">
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  Prévia{hasVariable ? " (com o nome de exemplo \"Maria\")" : ""}:
                </p>
                <p className="whitespace-pre-wrap">{bodyText.replaceAll("{{1}}", "Maria")}</p>
              </div>
            )}
          </div>

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <Button type="submit" disabled={isPending || !name || !bodyText.trim()}>
            {isPending ? "Enviando para a Meta..." : "Enviar para aprovação"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
