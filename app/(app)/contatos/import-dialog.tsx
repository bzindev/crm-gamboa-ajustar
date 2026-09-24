"use client";

import { useActionState, useState, useTransition } from "react";
import {
  previewImportContacts,
  commitImportContacts,
  type ImportPreviewState,
  type ImportCommitState,
  type ImportRow,
} from "@/lib/actions/contacts-import";
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
  const [preview, previewAction, isPreviewing] = useActionState<ImportPreviewState, FormData>(
    previewImportContacts,
    null,
  );
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [commitResult, setCommitResult] = useState<ImportCommitState>(null);
  const [isCommitting, startCommit] = useTransition();
  const [appliedPreview, setAppliedPreview] = useState<ImportPreviewState>(null);

  // Aplica cada resultado NOVO de previewAction exatamente uma vez —
  // rastreado por referência num state próprio, não pelo conteúdo de
  // `rows`. Sem isso, "Importar outro arquivo" (que zera `rows`
  // localmente) reaplicaria o preview antigo de novo no próximo render,
  // porque `preview` em si só muda quando o usuário analisa um arquivo
  // novo.
  if (preview !== appliedPreview) {
    setAppliedPreview(preview);
    if (preview?.rows) {
      setRows(preview.rows);
      setCommitResult(null);
    }
  }

  function handleConfirm() {
    if (!rows) return;
    startCommit(async () => {
      const result = await commitImportContacts(rows);
      setCommitResult(result);
      if (!result?.error) setRows(null);
    });
  }

  function handleReset() {
    setRows(null);
    setCommitResult(null);
  }

  const readyCount = rows?.length ?? 0;
  const toCreate = rows?.filter((r) => r.action === "create").length ?? 0;
  const toUpdate = rows?.filter((r) => r.action === "update").length ?? 0;

  return (
    <Dialog onOpenChange={(open) => !open && handleReset()}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Importar contatos</DialogTitle>
        </DialogHeader>

        {commitResult?.summary ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2 rounded-md border p-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="default">{commitResult.summary.created} criados</Badge>
                <Badge variant="secondary">{commitResult.summary.updated} atualizados</Badge>
                {commitResult.summary.failed > 0 && (
                  <Badge variant="destructive">{commitResult.summary.failed} falharam</Badge>
                )}
              </div>
            </div>
            <Button type="button" variant="outline" onClick={handleReset} className="w-fit">
              Importar outro arquivo
            </Button>
          </div>
        ) : (
          <>
            <form action={previewAction} className="flex flex-col gap-4">
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
                  Precisa ter colunas de nome e telefone (ex.: &quot;Nome&quot;,
                  &quot;Telefone&quot;) — a primeira linha é o cabeçalho. Telefone brasileiro em
                  qualquer formato comum é aceito (com/sem DDI, parênteses, traço, 9º dígito) — a
                  normalização é automática. E-mail é opcional. Contato com telefone já cadastrado
                  é atualizado, não duplicado. Importar não marca opt-in.
                </p>
              </div>

              {preview?.error && <p className="text-sm text-destructive">{preview.error}</p>}

              <Button type="submit" disabled={isPreviewing} className="w-fit">
                {isPreviewing ? "Analisando..." : "Analisar arquivo"}
              </Button>
            </form>

            {rows !== null && preview?.errors && (
              <div className="mt-4 flex flex-col gap-2 rounded-md border p-3 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="default">{toCreate} novos</Badge>
                  <Badge variant="secondary">{toUpdate} atualizados</Badge>
                  {preview.errors.length > 0 && (
                    <Badge variant="destructive">{preview.errors.length} com erro</Badge>
                  )}
                </div>
                {preview.errors.length > 0 && (
                  <ul className="max-h-40 list-disc overflow-y-auto pl-4 text-xs text-muted-foreground">
                    {preview.errors.map((e, i) => (
                      <li key={i}>
                        Linha {e.line}: {e.reason}
                      </li>
                    ))}
                  </ul>
                )}
                {commitResult?.error && <p className="text-destructive">{commitResult.error}</p>}
                <Button
                  type="button"
                  onClick={handleConfirm}
                  disabled={isCommitting || readyCount === 0}
                  className="mt-1 w-fit"
                >
                  {isCommitting ? "Importando..." : `Confirmar importação (${readyCount})`}
                </Button>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
