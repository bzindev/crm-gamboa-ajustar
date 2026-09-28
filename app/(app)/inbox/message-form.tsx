"use client";

import { useActionState, useRef } from "react";
import { sendMessage, type MessageActionState } from "@/lib/actions/messages";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send, Zap } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fillQuickReply } from "@/lib/validation/quick-replies";

export type QuickReplyOption = { id: string; title: string; body: string };

export function MessageForm({
  conversationId,
  readOnly,
  canClaim,
  outsideWindow,
  quickReplies = [],
  contactName = null,
}: {
  quickReplies?: QuickReplyOption[];
  contactName?: string | null;
  conversationId: string;
  /** Conversa atribuída a outra pessoa — modo leitura até alguém assumir. */
  readOnly: boolean;
  /** Se quem está vendo tem permissão de clicar "Assumir" a partir daqui. */
  canClaim: boolean;
  outsideWindow: boolean;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Insere no ponto do cursor (ou no fim), sem apagar o que já foi digitado
  // — o vendedor ainda revisa antes de mandar.
  function insertQuickReply(body: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = fillQuickReply(body, contactName);
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value = textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.focus();
    const caret = start + text.length;
    textarea.setSelectionRange(caret, caret);
  }
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
      <div className="border-t p-3">
        <p className="text-xs text-muted-foreground">
          {canClaim
            ? "Você está vendo em modo leitura — use \"Assumir conversa\" no topo para responder."
            : "Essa conversa é de outro vendedor — modo leitura."}
        </p>
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
        {quickReplies.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" title="Respostas rápidas">
                <Zap className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            {/* Sem isso o menu devolve o foco pro botão ao fechar e o cursor sai do texto. */}
            <DropdownMenuContent align="start" className="w-72" onCloseAutoFocus={(e) => e.preventDefault()}>
              <DropdownMenuLabel>Respostas rápidas</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="max-h-72 overflow-y-auto">
                {quickReplies.map((reply) => (
                  <DropdownMenuItem
                    key={reply.id}
                    onSelect={() => insertQuickReply(reply.body)}
                    className="flex flex-col items-start gap-0.5"
                  >
                    <span className="font-medium">{reply.title}</span>
                    <span className="line-clamp-2 text-xs text-muted-foreground">{reply.body}</span>
                  </DropdownMenuItem>
                ))}
              </div>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Textarea
          ref={textareaRef}
          name="body"
          placeholder="Escreva uma mensagem… (Enter envia · Shift+Enter pula linha)"
          className="min-h-10 flex-1 resize-none"
          rows={1}
          required
          onKeyDown={(event) => {
            // Igual ao WhatsApp Web. isComposing: ainda montando acento/
            // caractere no teclado — Enter ali confirma a letra, não envia.
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!isPending && event.currentTarget.value.trim()) formRef.current?.requestSubmit();
          }}
        />
        <Button type="submit" size="icon" disabled={isPending}>
          <Send className="size-4" />
        </Button>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
