"use client";

import { useActionState, useRef } from "react";
import { createQuickReply, type QuickReplyActionState } from "@/lib/actions/quick-replies";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function QuickReplyForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState<QuickReplyActionState, FormData>(
    async (prevState, formData) => {
      const result = await createQuickReply(prevState, formData);
      if (result?.success) formRef.current?.reset();
      return result;
    },
    null,
  );

  return (
    <form ref={formRef} action={formAction} className="flex max-w-xl flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="title">Nome</Label>
        <Input id="title" name="title" placeholder="Ex.: Saudação" required maxLength={60} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="body">Mensagem</Label>
        <Textarea
          id="body"
          name="body"
          rows={4}
          required
          maxLength={1000}
          placeholder="Olá, {nome}! Obrigado pelo contato com a Renault Gamboa. Como posso ajudar?"
        />
        <p className="text-xs text-muted-foreground">
          Use <code className="rounded bg-muted px-1">{"{nome}"}</code> pra inserir o primeiro nome do cliente.
        </p>
      </div>
      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      <Button type="submit" disabled={isPending} className="w-fit">
        {isPending ? "Salvando..." : "Adicionar"}
      </Button>
    </form>
  );
}
