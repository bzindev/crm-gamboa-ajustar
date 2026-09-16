"use client";

import { forwardRef, useState } from "react";
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
  tags: { id: string; name: string; color: string }[];
};

type Contact = { id: string; name: string; phone_e164: string };
type Member = { id: string; name: string };
type Tag = { id: string; name: string; color: string };
type Columns = Record<string, LeadCard[]>;

function groupByStage(stages: Stage[], leads: LeadCard[]): Columns {
  const grouped: Columns = {};
  for (const stage of stages) grouped[stage.id] = [];
  for (const lead of [...leads].sort((a, b) => a.position - b.position)) {
    (grouped[lead.stageId] ??= []).push(lead);
  }
  return grouped;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const initials = parts.length > 1 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

/** Fundo bem claro + texto na própria cor da tag — mais legível que só um contorno. */
function tagStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}1a`, color, borderColor: `${color}40` };
}

const LeadCardView = forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { lead: LeadCard }
>(function LeadCardView({ lead, ...props }, ref) {
  return (
    <div
      ref={ref}
      {...props}
      className="flex cursor-pointer flex-col gap-2.5 rounded-md border bg-background p-3 text-sm shadow-sm transition-shadow hover:border-primary/50 hover:shadow-md"
    >
      <p className="font-medium leading-tight">{lead.title}</p>
      {lead.contact && (
        <p className="text-xs text-muted-foreground">{lead.contact.name}</p>
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
    </div>
  );
});

function SortableLeadCard({
  lead,
  stages,
  contacts,
  tags,
  members,
}: {
  lead: LeadCard;
  stages: Stage[];
  contacts: Contact[];
  tags: Tag[];
  members: Member[];
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
        lead={lead}
        trigger={<LeadCardView lead={lead} />}
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
}: {
  stage: Stage;
  leads: LeadCard[];
  stages: Stage[];
  contacts: Contact[];
  tags: Tag[];
  members: Member[];
}) {
  const { setNodeRef } = useDroppable({ id: stage.id });
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
          defaultStageId={stage.id}
          trigger={
            <Button variant="ghost" size="icon" className="size-7">
              <Plus className="size-4" />
            </Button>
          }
        />
      </div>
      <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
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
  vocabulary,
  canManageSettings,
}: {
  pipelineId: string;
  stages: Stage[];
  initialLeads: LeadCard[];
  contacts: Contact[];
  tags: Tag[];
  members: Member[];
  vocabulary: Vocabulary;
  canManageSettings: boolean;
}) {
  const [columns, setColumns] = useState<Columns>(() => groupByStage(stages, initialLeads));
  const [activeLead, setActiveLead] = useState<LeadCard | null>(null);
  const [dragSnapshot, setDragSnapshot] = useState<Columns | null>(null);

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
    if (!over) return;

    const container = findContainer(String(active.id));
    if (!container) return;

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
            />
          ))}
        </div>
        <DragOverlay>{activeLead ? <LeadCardView lead={activeLead} /> : null}</DragOverlay>
      </DndContext>
    </div>
  );
}
