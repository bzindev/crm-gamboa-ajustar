"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import {
  Send,
  Zap,
  Paperclip,
  Image as ImageIcon,
  FileText,
  Mic,
  MapPin,
  MessageSquareText,
  X,
} from "lucide-react";
import {
  sendMessage,
  prepareMediaUpload,
  sendMediaMessage,
  type MessageActionState,
} from "@/lib/actions/messages";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fillQuickReply } from "@/lib/validation/quick-replies";
import {
  MEDIA_RULES,
  kindForMime,
  validateMediaFile,
  formatBytes,
} from "@/lib/whatsapp/media-rules";
import { LocationDialog } from "./location-dialog";
import { TemplateDialog, type TemplateOption } from "./template-dialog";

export type QuickReplyOption = { id: string; title: string; body: string };

type PendingFile = { file: File; previewUrl: string | null };

export function MessageForm({
  conversationId,
  readOnly,
  canClaim,
  outsideWindow,
  quickReplies = [],
  templates = [],
  contactName = null,
}: {
  /** Templates aprovados da organização — únicos que a Meta entrega. */
  templates?: TemplateOption[];
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingFile | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [locationOpen, setLocationOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [isSendingMedia, startMedia] = useTransition();

  // Insere no ponto do cursor (ou no fim), sem apagar o que já foi digitado
  // — o vendedor ainda revisa antes de mandar.
  function insertQuickReply(body: string) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const text = fillQuickReply(body, contactName);
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? textarea.value.length;
    textarea.value =
      textarea.value.slice(0, start) + text + textarea.value.slice(end);
    textarea.focus();
    const caret = start + text.length;
    textarea.setSelectionRange(caret, caret);
  }

  const [state, formAction, isPending] = useActionState<
    MessageActionState,
    FormData
  >(async (prevState, formData) => {
    const result = await sendMessage(prevState, formData);
    if (!result?.error) formRef.current?.reset();
    return result;
  }, null);

  function clearPending() {
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    setMediaError(null);
    const invalid = validateMediaFile(file.type, file.size);
    if (invalid) {
      setMediaError(invalid);
      return;
    }
    if (pending?.previewUrl) URL.revokeObjectURL(pending.previewUrl);
    setPending({
      file,
      previewUrl:
        kindForMime(file.type) === "image" ? URL.createObjectURL(file) : null,
    });
    textareaRef.current?.focus();
  }

  function openPicker(accept: string) {
    const input = fileInputRef.current;
    if (!input) return;
    input.accept = accept;
    input.click();
  }

  // Arquivo sobe direto do navegador pro Storage (link de uso único que o
  // servidor gera), e só depois o servidor manda pra Meta.
  function sendPendingFile() {
    if (!pending) return;
    const { file } = pending;
    const fileName = file.name || "arquivo";
    const caption = textareaRef.current?.value.trim() ?? "";
    const kind = kindForMime(file.type);
    setMediaError(null);
    startMedia(async () => {
      const prepared = await prepareMediaUpload({
        conversationId,
        fileName,
        mimeType: file.type,
        size: file.size,
      });
      if ("error" in prepared) {
        setMediaError(prepared.error);
        return;
      }
      const { error: uploadError } = await createClient()
        .storage.from("chat-media")
        .uploadToSignedUrl(prepared.path, prepared.token, file, {
          contentType: file.type,
        });
      if (uploadError) {
        setMediaError(
          "Falha ao enviar o arquivo. Confira a conexão e tente de novo.",
        );
        return;
      }
      const result = await sendMediaMessage({
        conversationId,
        path: prepared.path,
        mimeType: file.type,
        fileName,
        caption: kind === "audio" ? undefined : caption || undefined,
      });
      if (result?.error) {
        setMediaError(result.error);
        return;
      }
      // Áudio não aceita legenda na Meta — o texto vai numa mensagem separada.
      if (kind === "audio" && caption) {
        const formData = new FormData();
        formData.set("conversationId", conversationId);
        formData.set("body", caption);
        await sendMessage(null, formData);
      }
      clearPending();
      formRef.current?.reset();
    });
  }

  const busy = isPending || isSendingMedia;

  if (readOnly) {
    return (
      <div className="border-t p-3">
        <p className="text-xs text-muted-foreground">
          {canClaim
            ? 'Você está vendo em modo leitura — use "Assumir conversa" no topo para responder.'
            : "Essa conversa é de outro vendedor — modo leitura."}
        </p>
      </div>
    );
  }

  const templateDialog = (
    <TemplateDialog
      conversationId={conversationId}
      templates={templates}
      contactName={contactName}
      open={templateOpen}
      onOpenChange={setTemplateOpen}
    />
  );

  if (outsideWindow) {
    // Depois de 24h sem mensagem do cliente, a Meta só aceita template
    // aprovado — o resto da caixa de mensagem some pra não induzir ao erro.
    return (
      <>
        <div className="flex flex-wrap items-center justify-center gap-3 border-t p-3">
          <p className="text-xs text-muted-foreground">
            Fora da janela de 24h — só é possível responder com um template
            aprovado.
          </p>
          <Button type="button" size="sm" onClick={() => setTemplateOpen(true)}>
            <MessageSquareText className="size-4" />
            Enviar template
          </Button>
        </div>
        {templateDialog}
      </>
    );
  }

  const pendingKind = pending ? kindForMime(pending.file.type) : null;

  return (
    <>
      <form
        ref={formRef}
        action={formAction}
        onSubmit={(event) => {
          if (!pending) return;
          event.preventDefault();
          sendPendingFile();
        }}
        className="flex flex-col gap-2 border-t p-3"
      >
        <input type="hidden" name="conversationId" value={conversationId} />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(event) => pickFile(event.target.files?.[0])}
        />

        {pending && (
          <div className="flex items-center gap-3 rounded-md border bg-muted/40 p-2">
            {pending.previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={pending.previewUrl}
                alt=""
                className="size-14 rounded object-cover"
              />
            ) : (
              <div className="flex size-14 items-center justify-center rounded bg-muted">
                {pendingKind === "audio" ? (
                  <Mic className="size-6" />
                ) : (
                  <FileText className="size-6" />
                )}
              </div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-medium">
                {pending.file.name || "arquivo"}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(pending.file.size)} ·{" "}
                {pendingKind === "audio"
                  ? "áudio vai sem legenda (o texto segue numa mensagem à parte)"
                  : "o texto abaixo vira a legenda"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={clearPending}
              disabled={busy}
              title="Remover anexo"
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                title="Anexar"
                disabled={busy}
              >
                <Paperclip className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem
                onSelect={() =>
                  openPicker(
                    `${MEDIA_RULES.image.accept},${MEDIA_RULES.video.accept}`,
                  )
                }
              >
                <ImageIcon className="size-4" /> Foto ou vídeo
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => openPicker(MEDIA_RULES.document.accept)}
              >
                <FileText className="size-4" /> Documento
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => openPicker(MEDIA_RULES.audio.accept)}
              >
                <Mic className="size-4" /> Áudio
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setLocationOpen(true)}>
                <MapPin className="size-4" /> Localização
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setTemplateOpen(true)}>
                <MessageSquareText className="size-4" /> Template aprovado
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {quickReplies.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  title="Respostas rápidas"
                >
                  <Zap className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              {/* Sem isso o menu devolve o foco pro botão ao fechar e o cursor sai do texto. */}
              <DropdownMenuContent
                align="start"
                className="w-72"
                onCloseAutoFocus={(e) => e.preventDefault()}
              >
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
                      <span className="line-clamp-2 text-xs text-muted-foreground">
                        {reply.body}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Textarea
            ref={textareaRef}
            name="body"
            placeholder={
              pending
                ? "Legenda (opcional)… Enter envia"
                : "Escreva uma mensagem… (Enter envia · Shift+Enter pula linha)"
            }
            className="min-h-10 flex-1 resize-none"
            rows={1}
            required={!pending}
            onPaste={(event) => {
              // Print/imagem copiada: Ctrl+V anexa direto, igual ao WhatsApp Web.
              const image = [...event.clipboardData.files].find((f) =>
                f.type.startsWith("image/"),
              );
              if (image) {
                event.preventDefault();
                pickFile(image);
              }
            }}
            onKeyDown={(event) => {
              // Igual ao WhatsApp Web. isComposing: ainda montando acento/
              // caractere no teclado — Enter ali confirma a letra, não envia.
              if (
                event.key !== "Enter" ||
                event.shiftKey ||
                event.nativeEvent.isComposing
              )
                return;
              event.preventDefault();
              if (busy) return;
              if (pending || event.currentTarget.value.trim())
                formRef.current?.requestSubmit();
            }}
          />
          <Button type="submit" size="icon" disabled={busy} title="Enviar">
            <Send className="size-4" />
          </Button>
        </div>
        {isSendingMedia && (
          <p className="text-xs text-muted-foreground">Enviando arquivo…</p>
        )}
        {(mediaError || state?.error) && (
          <p className="text-xs text-destructive">
            {mediaError ?? state?.error}
          </p>
        )}
      </form>
      <LocationDialog
        conversationId={conversationId}
        open={locationOpen}
        onOpenChange={setLocationOpen}
      />
      {templateDialog}
    </>
  );
}
