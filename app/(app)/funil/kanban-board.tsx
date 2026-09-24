"use client";

import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, Inbox } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { moveLead } from "@/lib/actions/leads";
import { calculateNewPosition } from "@/lib/crm/position";
import { formatCents } from "@/lib/format/currency";
import { getInitials } from "@/lib/format/initials";
import { cn } from "@/lib/utils";
import type { Vocabulary } from "@/lib/validation/pipelines";
import { LeadDialog } from "./lead-dialog";
import { PipelineSettingsSheet } from "./pipeline-settings-sheet";

export type Stage = {
  id: string;
  name: string;
  position: number;
  is_won: boolean;
  is_lost: boolean;
};

export type Temperature = "cold" | "warm" | "hot";

export type LeadCard = {
  id: string;
  title: string;
  valueCents: number | null;
  status: "open" | "won" | "lost";
  position: number;
  stageId: string;
  contact: { name: string; phone_e164: string } | null;
  ownerName: string | null;
  ownerId: string | null;
  lostReason: string | null;
  vehicleInterest: string | null;
  temperature: Temperature;
  origin: string | null;
  campaign: string | null;
  teamName: string | null;
  teamId: string | null;
  stageEnteredAt: string;
  tags: { id: string; name: string; color: string }[];
};

function daysInStage(stageEnteredAt: string): number {
  const ms = Date.now() - new Date(stageEnteredAt).getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

const TEMPERATURE_BADGE: Record<Temperature, { label: string; className: string }> = {
  cold: { label: "Frio", className: "bg-muted text-muted-foreground" },
  warm: { label: "Morno", className: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300" },
  hot: { label: "🔥 Quente", className: "bg-primary text-primary-foreground" },
};

type Contact = { id: string; name: string; phone_e164: string };
type Member = { id: string; name: string };
type Tag = { id: string; name: string; color: string };
type Team = { id: string; name: string };
type Columns = Record<string, LeadCard[]>;

function groupByStage(stages: Stage[], leads: LeadCard[]): Columns {
  const grouped: Columns = {};
  for (const stage of stages) grouped[stage.id] = [];
  for (const lead of [...leads].sort((a, b) => a.position - b.position)) {
    (grouped[lead.stageId] ??= []).push(lead);
  }
  return grouped;
}

/** Fundo bem claro + texto na própria cor da tag — mais legível que só um contorno. */
function tagStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}1a`, color, borderColor: `${color}40` };
}

const LeadCardView = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { lead: LeadCard; stageAlertDays: number }
>(function LeadCardView({ lead, stageAlertDays, ...props }, ref) {
  return (
    <div
      ref={ref}
      {...props}
      className="flex cursor-pointer flex-col gap-2.5 rounded-md border bg-background p-3 text-sm shadow-sm transition-shadow hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="font-medium leading-tight">{lead.title}</p>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium",
            TEMPERATURE_BADGE[lead.temperature].className,
          )}
        >
          {TEMPERATURE_BADGE[lead.temperature].label}
        </span>
      </div>
      {lead.contact && (
        <p className="text-xs text-muted-foreground">{lead.contact.name}</p>
      )}
      {lead.vehicleInterest && (
        <p className="text-xs font-medium text-foreground/80">🚗 {lead.vehicleInterest}</p>
      )}
      {lead.origin && (
        <p className="text-xs text-muted-foreground">
          {lead.origin}
          {lead.campaign ? ` · ${lead.campaign}` : ""}
        </p>
      )}
      {lead.teamName && (
        <Badge variant="outline" className="w-fit border-white/15 bg-white/5 text-zinc-200">
          {lead.teamName}
        </Badge>
      )}

      {lead.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lead.tags.map((tag) => (
            <Badge key={tag.id} variant="outline" style={tagStyle(tag.color)}>
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <span className="text-sm font-semibold text-primary">
          {formatCents(lead.valueCents)}
        </span>
        {lead.ownerName && (
          <Avatar className="size-6">
            <AvatarFallback className="bg-sidebar-accent text-[10px] text-sidebar-accent-foreground">
              {getInitials(lead.ownerName)}
            </AvatarFallback>
          </Avatar>
        )}
      </div>

      {lead.status === "open" && (
        <StageDwellIndicator stageEnteredAt={lead.stageEnteredAt} stageAlertDays={stageAlertDays} />
      )}
    </div>
  );
});

function StageDwellIndicator({
  stageEnteredAt,
  stageAlertDays,
}: {
  stageEnteredAt: string;
  stageAlertDays: number;
}) {
  const days = daysInStage(stageEnteredAt);
  const stuck = days >= stageAlertDays;

  return (
    <p className={cn("text-[11px]", stuck ? "font-medium text-destructive" : "text-muted-foreground")}>
      {stuck && "⚠ "}
      {days === 0 ? "Entrou hoje nesta etapa" : `${days}d nesta etapa`}
    </p>
  );
}

function SortableLeadCard({
  lead,
  stages,
  contacts,
  tags,
  members,
  teams,
  stageAlertDays,
}: {
  lead: LeadCard;
  stages: Stage[];
  contacts: Contact[];
  tags: Tag[];
  members: Member[];
  teams: Team[];
  stageAlertDays: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <LeadDialog
        stages={stages}
        contacts={contacts}
        tags={tags}
        members={members}
        teams={teams}
        lead={lead}
        trigger={<LeadCardView lead={lead} stageAlertDays={stageAlertDays} />}
      />
    </div>
  );
}

function Column({
  stage,
  leads,
  stages,
  contacts,
  tags,
  members,
  teams,
  stageAlertDays,
}: {
  stage: Stage;
  leads: LeadCard[];
  stages: Stage[];
  contacts: Contact[];
  tags: Tag[];
  members: Member[];
  teams: Team[];
  stageAlertDays: number;
}) {
  const { setNodeRef } = useDroppable({ id: stage.id });
  const leadIds = useMemo(() => leads.map((l) => l.id), [leads]);
  const totalCents = leads.reduce((sum, l) => sum + (l.valueCents ?? 0), 0);
  const dotColor = stage.is_won
    ? "bg-primary"
    : stage.is_lost
      ? "bg-destructive"
      : "bg-muted-foreground/40";

  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 rounded-lg border bg-background p-3">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", dotColor)} />
          <div>
            <h2 className="text-sm font-semibold">{stage.name}</h2>
            <p className="text-xs text-muted-foreground">
              {leads.length} · {formatCents(totalCents)}
            </p>
          </div>
        </div>
        <LeadDialog
          stages={stages}
          contacts={contacts}
          tags={tags}
          members={members}
          teams={teams}
          defaultStageId={stage.id}
          trigger={
            <Button variant="ghost" size="icon" className="size-7">
              <Plus className="size-4" />
            </Button>
          }
        />
      </div>
      <SortableContext items={leadIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-[80px] flex-1 flex-col gap-2">
          {leads.length === 0 ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
              <Inbox className="size-5" />
              Nenhum lead aqui ainda
            </div>
          ) : (
            leads.map((lead) => (
              <SortableLeadCard
                key={lead.id}
                lead={lead}
                stages={stages}
                contacts={contacts}
                tags={tags}
                members={members}
                teams={teams}
                stageAlertDays={stageAlertDays}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}

export function KanbanBoard({
  pipelineId,
  stages,
  initialLeads,
  contacts,
  tags,
  members,
  teams,
  vocabulary,
  canManageSettings,
  stageAlertDays,
}: {
  pipelineId: string;
  stages: Stage[];
  initialLeads: LeadCard[];
  contacts: Contact[];
  tags: Tag[];
  members: Member[];
  teams: Team[];
  vocabulary: Vocabulary;
  canManageSettings: boolean;
  stageAlertDays: number;
}) {
  const [columns, setColumns] = useState<Columns>(() => groupByStage(stages, initialLeads));
  const [activeLead, setActiveLead] = useState<LeadCard | null>(null);
  const [dragSnapshot, setDragSnapshot] = useState<Columns | null>(null);
  const isDraggingRef = useRef(false);

  // Sem isso, o board nunca refletia dado vindo de outra pessoa — o
  // estado local só existia pra suportar o drag otimista, e depois do
  // mount inicial nunca mais olhava pra initialLeads de novo. Ignora
  // atualização enquanto um drag está em andamento pra não "puxar o
  // tapete" do card que a própria pessoa está arrastando.
  useEffect(() => {
    if (!isDraggingRef.current) {
      setColumns(groupByStage(stages, initialLeads));
    }
  }, [stages, initialLeads]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  function findContainer(id: string): string | undefined {
    if (columns[id]) return id;
    return Object.keys(columns).find((stageId) => columns[stageId].some((l) => l.id === id));
  }

  function handleDragStart(event: DragStartEvent) {
    const container = findContainer(String(event.active.id));
    if (!container) return;
    isDraggingRef.current = true;
    setDragSnapshot(columns);
    setActiveLead(columns[container].find((l) => l.id === event.active.id) ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeContainer = findContainer(String(active.id));
    const overContainer = findContainer(String(over.id));
    if (!activeContainer || !overContainer || activeContainer === overContainer) return;

    setColumns((prev) => {
      const activeItems = prev[activeContainer];
      const overItems = prev[overContainer];
      const activeIndex = activeItems.findIndex((l) => l.id === active.id);
      if (activeIndex === -1) return prev;
      const overIndex = overItems.findIndex((l) => l.id === over.id);

      const movedLead = { ...activeItems[activeIndex], stageId: overContainer };
      const insertIndex = overIndex >= 0 ? overIndex : overItems.length;

      return {
        ...prev,
        [activeContainer]: activeItems.filter((l) => l.id !== active.id),
        [overContainer]: [
          ...overItems.slice(0, insertIndex),
          movedLead,
          ...overItems.slice(insertIndex),
        ],
      };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveLead(null);
    if (!over) {
      isDraggingRef.current = false;
      return;
    }

    const container = findContainer(String(active.id));
    if (!container) {
      isDraggingRef.current = false;
      return;
    }

    const items = columns[container];
    const activeIndex = items.findIndex((l) => l.id === active.id);
    const overIndex =
      over.id === container ? items.length - 1 : items.findIndex((l) => l.id === over.id);

    let reordered = items;
    if (activeIndex !== -1 && overIndex !== -1 && activeIndex !== overIndex) {
      reordered = arrayMove(items, activeIndex, overIndex);
    }

    const finalIndex = reordered.findIndex((l) => l.id === active.id);
    const prevLead = reordered[finalIndex - 1];
    const nextLead = reordered[finalIndex + 1];
    const newPosition = calculateNewPosition(
      prevLead?.position ?? null,
      nextLead?.position ?? null,
    );

    setColumns((prev) => ({
      ...prev,
      [container]: reordered.map((l) =>
        l.id === active.id ? { ...l, position: newPosition } : l,
      ),
    }));

    const result = await moveLead({ leadId: active.id, stageId: container, position: newPosition });
    if (result.error) {
      toast.error(result.error);
      if (dragSnapshot) setColumns(dragSnapshot);
    }
    isDraggingRef.current = false;
  }

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{vocabulary.lead_plural}</h1>
        {canManageSettings && (
          <PipelineSettingsSheet
            pipelineId={pipelineId}
            stages={stages}
            vocabulary={vocabulary}
          />
        )}
      </div>

      <DndContext
        id="funil-kanban"
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
          {stages.map((stage) => (
            <Column
              key={stage.id}
              stage={stage}
              leads={columns[stage.id] ?? []}
              stages={stages}
              contacts={contacts}
              tags={tags}
              members={members}
              teams={teams}
              stageAlertDays={stageAlertDays}
            />
          ))}
        </div>
        <DragOverlay>
          {activeLead ? <LeadCardView lead={activeLead} stageAlertDays={stageAlertDays} /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
