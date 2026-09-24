"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  useDroppable,
  useDraggable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/format/initials";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { updateConversationStatus } from "@/lib/actions/conversations";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "./conversation-list";

type Status = ConversationSummary["status"];

const COLUMNS: { id: Status; label: string }[] = [
  { id: "open", label: "Aberta" },
  { id: "pending", label: "Pendente" },
  { id: "resolved", label: "Resolvida" },
  { id: "closed", label: "Fechada" },
];

function ConversationCardView({ conversation }: { conversation: ConversationSummary }) {
  return (
    <div className="flex cursor-pointer flex-col gap-1.5 rounded-md border bg-background p-3 text-sm shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-center gap-2">
        <Avatar className="size-6 shrink-0">
          <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
            {getInitials(conversation.contactName)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate font-medium">{conversation.contactName}</span>
      </div>
      <p className="truncate text-xs text-muted-foreground">
        {conversation.lastMessagePreview ?? conversation.contactPhone}
      </p>
      <div className="flex items-center justify-between">
        <Badge variant="outline" className="text-[10px]">
          {conversation.assignedToMe
            ? "Com você"
            : (conversation.assignedToName ?? "Sem vendedor")}
        </Badge>
        {conversation.lastActivityAt && (
          <span className="text-[10px] text-muted-foreground">
            {formatRelativeTime(conversation.lastActivityAt)}
          </span>
        )}
      </div>
    </div>
  );
}

function DraggableCard({
  conversation,
  onOpen,
}: {
  conversation: ConversationSummary;
  onOpen: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: conversation.id,
  });

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(conversation.id)}
    >
      <ConversationCardView conversation={conversation} />
    </div>
  );
}

function Column({
  status,
  label,
  conversations,
  onOpen,
}: {
  status: Status;
  label: string;
  conversations: ConversationSummary[];
  onOpen: (id: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col gap-2 rounded-lg border bg-muted/30 p-3 transition-colors",
        isOver && "border-primary/50 bg-primary/5",
      )}
    >
      <div className="flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold">{label}</h2>
        <span className="text-xs text-muted-foreground">{conversations.length}</span>
      </div>
      <div className="flex min-h-[80px] flex-1 flex-col gap-2 overflow-y-auto">
        {conversations.map((conversation) => (
          <DraggableCard key={conversation.id} conversation={conversation} onOpen={onOpen} />
        ))}
      </div>
    </div>
  );
}

function groupByStatus(conversations: ConversationSummary[]): Record<Status, ConversationSummary[]> {
  const grouped: Record<Status, ConversationSummary[]> = {
    open: [],
    pending: [],
    resolved: [],
    closed: [],
  };
  for (const c of conversations) grouped[c.status].push(c);
  return grouped;
}

export function ConversationKanban({ conversations }: { conversations: ConversationSummary[] }) {
  const router = useRouter();
  const [columns, setColumns] = useState<Record<Status, ConversationSummary[]>>(() =>
    groupByStatus(conversations),
  );
  const [activeCard, setActiveCard] = useState<ConversationSummary | null>(null);
  const isDraggingRef = useRef(false);

  // Sem isso, o board só refletia a própria movimentação (drag otimista) —
  // conversa nova ou status mudado por outro vendedor só aparecia
  // recarregando a página na mão. Ignora enquanto um drag está em
  // andamento pra não competir com o estado otimista local.
  useEffect(() => {
    if (!isDraggingRef.current) {
      setColumns(groupByStatus(conversations));
    }
  }, [conversations]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  function findColumn(conversationId: string): Status | undefined {
    return (Object.keys(columns) as Status[]).find((status) =>
      columns[status].some((c) => c.id === conversationId),
    );
  }

  function handleDragStart(event: DragStartEvent) {
    const source = findColumn(String(event.active.id));
    if (!source) return;
    isDraggingRef.current = true;
    setActiveCard(columns[source].find((c) => c.id === event.active.id) ?? null);
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);
    if (!over) {
      isDraggingRef.current = false;
      return;
    }

    const source = findColumn(String(active.id));
    const target = COLUMNS.some((c) => c.id === over.id) ? (over.id as Status) : findColumn(String(over.id));
    if (!source || !target || source === target) {
      isDraggingRef.current = false;
      return;
    }

    const card = columns[source].find((c) => c.id === active.id);
    if (!card) {
      isDraggingRef.current = false;
      return;
    }

    setColumns((prev) => ({
      ...prev,
      [source]: prev[source].filter((c) => c.id !== active.id),
      [target]: [{ ...card, status: target }, ...prev[target]],
    }));

    const formData = new FormData();
    formData.set("conversationId", card.id);
    formData.set("status", target);
    const result = await updateConversationStatus(null, formData);
    if (result?.error) {
      toast.error(result.error);
      setColumns((prev) => ({
        ...prev,
        [target]: prev[target].filter((c) => c.id !== active.id),
        [source]: [card, ...prev[source]],
      }));
    }
    isDraggingRef.current = false;
  }

  const openConversation = useCallback((id: string) => router.push(`/inbox/${id}`), [router]);

  return (
    <DndContext
      id="inbox-kanban"
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-4 overflow-x-auto rounded-lg border bg-background p-4">
        {COLUMNS.map((column) => (
          <Column
            key={column.id}
            status={column.id}
            label={column.label}
            conversations={columns[column.id]}
            onOpen={openConversation}
          />
        ))}
      </div>
      <DragOverlay>{activeCard ? <ConversationCardView conversation={activeCard} /> : null}</DragOverlay>
    </DndContext>
  );
}
