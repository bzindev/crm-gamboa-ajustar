"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { sendTemplate } from "@/lib/actions/messages";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export type TemplateOption = {
  id: string;
  name: string;
  category: string;
  bodyText: string;
  variableCount: number;
};

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

/**
 * Escolher e enviar um template aprovado. É o único jeito de falar com o
 * cliente depois de 24h sem resposta dele — e também serve dentro da janela.
 */
export function TemplateDialog({
  conversationId,
  templates,
  contactName,
  open,
  onOpenChange,
}: {
  conversationId: string;
  templates: TemplateOption[];
  contactName: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Já vem com o primeiro nome do contato — é o uso mais comum do {{1}}.
  const [variable, setVariable] = useState(contactName?.split(" ")[0] ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const visible = templates.filter((t) =>
    `${t.name} ${t.bodyText}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const selected = templates.find((t) => t.id === selectedId) ?? null;
  const needsVariable = Boolean(selected && selected.variableCount > 0);
  const preview = selected
    ? selected.bodyText.replace("{{1}}", variable.trim() || "{{1}}")
    : null;

  function send() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      const result = await sendTemplate({
        conversationId,
        templateId: selected.id,
        variable: needsVariable ? variable : undefined,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setSelectedId(null);
      setQuery("");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Enviar template</DialogTitle>
          <DialogDescription>
            Só aparecem templates já aprovados pela Meta. Eles podem ser enviados mesmo depois de 24h sem
            resposta do cliente.
          </DialogDescription>
        </DialogHeader>

        {templates.length === 0 ? (
          <div className="flex flex-col items-start gap-2 text-sm text-muted-foreground">
            <p>Nenhum template aprovado ainda.</p>
            <Button asChild variant="outline" size="sm">
              <Link href="/disparos/templates">Criar template</Link>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar template"
                className="pl-8"
              />
            </div>

            <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto">
              {visible.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setSelectedId(template.id)}
                  aria-pressed={template.id === selectedId}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-md border p-2.5 text-left transition-colors",
                    template.id === selectedId ? "border-primary bg-primary/10" : "hover:bg-muted/50",
                  )}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium">{template.name}</span>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {CATEGORY_LABELS[template.category] ?? template.category}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-xs text-muted-foreground">{template.bodyText}</span>
                </button>
              ))}
              {visible.length === 0 && <p className="text-xs text-muted-foreground">Nenhum template com esse nome.</p>}
            </div>

            {selected && (
              <>
                {needsVariable && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="template-variable">Texto da variável {"{{1}}"}</Label>
                    <Input
                      id="template-variable"
                      value={variable}
                      onChange={(e) => setVariable(e.target.value)}
                      placeholder="Ex.: nome do cliente"
                      maxLength={200}
                    />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs text-muted-foreground">Como o cliente vai receber</span>
                  <p className="rounded-lg bg-primary px-3 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                    {preview}
                  </p>
                </div>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button
              type="button"
              onClick={send}
              disabled={!selected || isPending || (needsVariable && !variable.trim())}
            >
              {isPending ? "Enviando..." : "Enviar template"}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
