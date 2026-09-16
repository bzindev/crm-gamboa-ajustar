"use client";

import { useActionState, useState } from "react";
import {
  updateVocabulary,
  createStage,
  renameStage,
  deleteStage,
  type PipelineActionState,
} from "@/lib/actions/pipelines";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { Stage } from "./kanban-board";
import type { Vocabulary } from "@/lib/validation/pipelines";

function StageRow({ stage }: { stage: Stage }) {
  const [renameState, renameAction, isRenaming] = useActionState<PipelineActionState, FormData>(
    renameStage,
    null,
  );
  const [, deleteAction, isDeleting] = useActionState<PipelineActionState, FormData>(
    deleteStage,
    null,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <div className="flex flex-col gap-1 border-b pb-2">
      <div className="flex items-center gap-2">
        <form action={renameAction} className="flex flex-1 items-center gap-2">
          <input type="hidden" name="stageId" value={stage.id} />
          <Input name="name" defaultValue={stage.name} className="h-8" />
          <Button type="submit" size="sm" variant="outline" disabled={isRenaming}>
            Salvar
          </Button>
        </form>
        {confirmingDelete ? (
          <form action={deleteAction}>
            <input type="hidden" name="stageId" value={stage.id} />
            <Button type="submit" size="sm" variant="destructive" disabled={isDeleting}>
              Confirmar
            </Button>
          </form>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>
            Apagar
          </Button>
        )}
      </div>
      {renameState?.error && <p className="text-xs text-destructive">{renameState.error}</p>}
    </div>
  );
}

function AddStageForm({ pipelineId }: { pipelineId: string }) {
  const [state, formAction, isPending] = useActionState<PipelineActionState, FormData>(
    createStage,
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="pipelineId" value={pipelineId} />
      <Input name="name" placeholder="Nova etapa" className="h-8" required />
      <Button type="submit" size="sm" disabled={isPending}>
        Adicionar
      </Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

function VocabularyForm({ vocabulary }: { vocabulary: Vocabulary }) {
  const [state, formAction, isPending] = useActionState<PipelineActionState, FormData>(
    updateVocabulary,
    null,
  );

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="lead_singular" className="text-xs">
            Lead (singular)
          </Label>
          <Input
            id="lead_singular"
            name="lead_singular"
            defaultValue={vocabulary.lead_singular}
            className="h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lead_plural" className="text-xs">
            Lead (plural)
          </Label>
          <Input
            id="lead_plural"
            name="lead_plural"
            defaultValue={vocabulary.lead_plural}
            className="h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="won_label" className="text-xs">
            Rótulo de ganho
          </Label>
          <Input
            id="won_label"
            name="won_label"
            defaultValue={vocabulary.won_label}
            className="h-8"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="lost_label" className="text-xs">
            Rótulo de perda
          </Label>
          <Input
            id="lost_label"
            name="lost_label"
            defaultValue={vocabulary.lost_label}
            className="h-8"
          />
        </div>
      </div>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
      <Button type="submit" size="sm" disabled={isPending} className="self-start">
        Salvar vocabulário
      </Button>
    </form>
  );
}

export function PipelineSettingsSheet({
  pipelineId,
  stages,
  vocabulary,
}: {
  pipelineId: string;
  stages: Stage[];
  vocabulary: Vocabulary;
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm">
          Configurações do funil
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-6 overflow-y-auto p-6">
        <SheetHeader className="p-0">
          <SheetTitle>Configurações do funil</SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Vocabulário</h3>
          <VocabularyForm vocabulary={vocabulary} />
        </div>

        <div className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Etapas</h3>
          <div className="flex flex-col gap-2">
            {stages.map((stage) => (
              <StageRow key={stage.id} stage={stage} />
            ))}
          </div>
          <AddStageForm pipelineId={pipelineId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
