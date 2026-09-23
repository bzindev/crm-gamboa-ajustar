"use client";

import { useActionState, useRef } from "react";
import { sendMessage, type MessageActionState } from "@/lib/actions/messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";
import { ClaimButton } from "./claim-button";

export function MessageForm({
  conversationId,
  readOnly,
  canClaim,
  outsideWindow,
}: {
  conversationId: string;
  /** Conversa atribuída a outra pessoa — modo leitura até alguém assumir. */
  readOnly: boolean;
  /** Se quem está vendo tem permissão de clicar "Assumir" a partir daqui. */
  canClaim: boolean;
  outsideWindow: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState<MessageActionState, FormData>(
    async (prevState, formData) => {
      const result = await sendMessage(prevState, formData);
      if (!result?.error) formRef.current?.reset();
      return result;
    },
    null,
  );

  if (readOnly) {
    return (
      <div className="flex items-center justify-between gap-3 border-t p-3">
        <p className="text-xs text-muted-foreground">
          {canClaim
            ? "Você está vendo em modo leitura — assuma a conversa para responder."
            : "Essa conversa é de outro vendedor — modo leitura."}
        </p>
        {canClaim && <ClaimButton conversationId={conversationId} />}
      </div>
    );
  }

  if (outsideWindow) {
    return (
      <div className="border-t p-3 text-center text-xs text-muted-foreground">
        Fora da janela de 24h — só é possível responder com um template aprovado (fora do escopo
        desta fase).
      </div>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-2 border-t p-3">
      <input type="hidden" name="conversationId" value={conversationId} />
      <div className="flex items-end gap-2">
        <Textarea
          name="body"
          placeholder="Escreva uma mensagem..."
          className="min-h-10 flex-1 resize-none"
          rows={1}
          required
        />
        <Button type="submit" size="icon" disabled={isPending}>
          <Send className="size-4" />
        </Button>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
