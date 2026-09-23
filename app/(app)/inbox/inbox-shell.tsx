"use client";

import { useState } from "react";
import { List, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ConversationList, type ConversationSummary } from "./conversation-list";
import { ConversationKanban } from "./conversation-kanban";

type ViewMode = "list" | "kanban";

export function InboxShell({
  conversations,
  children,
}: {
  conversations: ConversationSummary[];
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<ViewMode>("list");

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant={mode === "list" ? "secondary" : "ghost"}
          size="sm"
          className={cn("gap-1.5", mode === "list" && "pointer-events-none")}
          onClick={() => setMode("list")}
        >
          <List className="size-4" />
          Lista
        </Button>
        <Button
          type="button"
          variant={mode === "kanban" ? "secondary" : "ghost"}
          size="sm"
          className={cn("gap-1.5", mode === "kanban" && "pointer-events-none")}
          onClick={() => setMode("kanban")}
        >
          <LayoutGrid className="size-4" />
          Kanban
        </Button>
      </div>

      {mode === "list" ? (
        <div className="flex flex-1 gap-4 overflow-hidden">
          <ConversationList conversations={conversations} />
          <div className="flex-1 overflow-hidden rounded-lg border bg-background">{children}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-hidden">
          <ConversationKanban conversations={conversations} />
        </div>
      )}
    </div>
  );
}
