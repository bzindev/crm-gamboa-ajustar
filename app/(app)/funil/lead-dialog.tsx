"use client";

import { useActionState, useState } from "react";
import { createLead, updateLead, type LeadActionState } from "@/lib/actions/leads";
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
import type { Stage, LeadCard, Temperature } from "./kanban-board";
import { TEMPERATURE_LABELS } from "@/lib/validation/leads";

type Contact = { id: string; name: string; phone_e164: string };
type Member = { id: string; name: string };
type Tag = { id: string; name: string; color: string };
type Team = { id: string; name: string };

export function LeadDialog({
  stages,
  contacts,
  members,
  tags,
  teams,
  defaultStageId,
  lead,
  trigger,
}: {
  stages: Stage[];
  contacts: Contact[];
  members: Member[];
  tags: Tag[];
  teams: Team[];
  defaultStageId?: string;
  lead?: LeadCard;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [contactMode, setContactMode] = useState<"existing" | "new">(
    contacts.length === 0 ? "new" : "existing",
  );
  const [status, setStatus] = useState<"open" | "won" | "lost">(lead?.status ?? "open");

  const action = lead ? updateLead : createLead;
  const [state, formAction, isPending] = useActionState<LeadActionState, FormData>(
    action,
    null,
  );

  // Fecha o dialog assim que a action devolver { success: true } — ajuste
  // de estado durante o render (padrão recomendado pelo React em vez de
  // useEffect) comparando com o resultado do render anterior.
  const [handledState, setHandledState] = useState(state);
  if (state !== handledState) {
    setHandledState(state);
    if (state?.success) {
      setOpen(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{lead ? "Editar lead" : "Novo lead"}</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          {lead && <input type="hidden" name="id" value={lead.id} />}

          <div className="flex flex-col gap-2">
            <Label htmlFor="title">Título</Label>
            <Input id="title" name="title" defaultValue={lead?.title} required />
          </div>

          {!lead && (
            <div className="flex flex-col gap-2">
              <Label>Contato</Label>
              {contacts.length > 0 && (
                <div className="flex gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={contactMode === "existing"}
                      onChange={() => setContactMode("existing")}
                    />
                    Selecionar existente
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      checked={contactMode === "new"}
                      onChange={() => setContactMode("new")}
                    />
                    Criar novo
                  </label>
                </div>
              )}

              {contactMode === "existing" && contacts.length > 0 ? (
                <select
                  name="contactId"
                  className="h-9 rounded-md border bg-transparent px-3 text-sm"
                  required
                >
                  <option value="">Selecione...</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} — {c.phone_e164}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="flex gap-2">
                  <Input name="newContactName" placeholder="Nome" required />
                  <Input name="newContactPhone" placeholder="+5511999999999" required />
                </div>
              )}
            </div>
          )}

          {lead?.contact && (
            <div className="flex flex-col gap-2">
              <Label>Contato</Label>
              <p className="text-sm text-muted-foreground">
                {lead.contact.name} — {lead.contact.phone_e164}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="stageId">Etapa</Label>
              <select
                id="stageId"
                name="stageId"
                defaultValue={lead?.stageId ?? defaultStageId}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="valueReais">Valor (R$)</Label>
              <Input
                id="valueReais"
                name="valueReais"
                type="number"
                step="0.01"
                min="0"
                defaultValue={lead?.valueCents != null ? (lead.valueCents / 100).toFixed(2) : ""}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="vehicleInterest">Veículo de interesse</Label>
            <Input
              id="vehicleInterest"
              name="vehicleInterest"
              placeholder="Ex.: Kardian Iconic"
              defaultValue={lead?.vehicleInterest ?? ""}
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="temperature">Temperatura</Label>
              <select
                id="temperature"
                name="temperature"
                defaultValue={lead?.temperature ?? "cold"}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                {(Object.keys(TEMPERATURE_LABELS) as Temperature[]).map((key) => (
                  <option key={key} value={key}>
                    {TEMPERATURE_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="origin">Origem</Label>
              <Input
                id="origin"
                name="origin"
                list="origin-suggestions"
                placeholder="Meta, Indicação..."
                defaultValue={lead?.origin ?? ""}
              />
              <datalist id="origin-suggestions">
                <option value="Meta / Instagram" />
                <option value="Google" />
                <option value="Indicação" />
                <option value="Loja física" />
                <option value="Site" />
              </datalist>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="campaign">Campanha</Label>
              <Input
                id="campaign"
                name="campaign"
                placeholder="Opcional"
                defaultValue={lead?.campaign ?? ""}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="ownerId">Responsável</Label>
              <select
                id="ownerId"
                name="ownerId"
                defaultValue={lead?.ownerId ?? ""}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="">Sem responsável</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="teamId">Setor</Label>
              <select
                id="teamId"
                name="teamId"
                defaultValue={lead?.teamId ?? ""}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="">Sem setor</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {tags.length > 0 && (
            <div className="flex flex-col gap-2">
              <Label>Tags</Label>
              <div className="flex flex-wrap gap-3">
                {tags.map((tag) => (
                  <label key={tag.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      name="tagIds"
                      value={tag.id}
                      defaultChecked={lead?.tags.some((t) => t.id === tag.id)}
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </div>
          )}

          {lead && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="status">Status</Label>
              <select
                id="status"
                name="status"
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="h-9 rounded-md border bg-transparent px-3 text-sm"
              >
                <option value="open">Em aberto</option>
                <option value="won">Ganho</option>
                <option value="lost">Perdido</option>
              </select>
              {status === "lost" && (
                <Textarea
                  name="lostReason"
                  placeholder="Motivo da perda"
                  defaultValue={lead?.lostReason ?? ""}
                  required
                />
              )}
            </div>
          )}

          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

          <Button type="submit" disabled={isPending}>
            {isPending ? "Salvando..." : "Salvar"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
