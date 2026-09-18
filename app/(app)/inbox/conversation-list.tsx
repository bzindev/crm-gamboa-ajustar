"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { getInitials } from "@/lib/format/initials";
import { cn } from "@/lib/utils";

export type ConversationSummary = {
  id: string;
  contactName: string;
  contactPhone: string;
  status: "open" | "pending" | "resolved" | "closed";
  lastMessagePreview: string | null;
  lastActivityAt: string | null;
};

const STATUS_LABELS: Record<ConversationSummary["status"], string> = {
  open: "Aberta",
  pending: "Pendente",
  resolved: "Resolvida",
  closed: "Fechada",
};

export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-y-auto rounded-lg border bg-background">
      <div className="border-b px-4 py-3">
        <h1 className="text-sm font-semibold">Conversas</h1>
      </div>
      {conversations.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
      ) : (
        conversations.map((conversation) => {
          const isActive = pathname === `/inbox/${conversation.id}`;
          return (
            <Link
              key={conversation.id}
              href={`/inbox/${conversation.id}`}
              className={cn(
                "flex items-start gap-2.5 border-b px-4 py-3 text-sm transition-colors hover:bg-muted/50",
                isActive && "bg-muted",
              )}
            >
              <Avatar className="size-8 shrink-0">
                <AvatarFallback className="bg-[#18181b] text-[10px] font-semibold text-white">
                  {getInitials(conversation.contactName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{conversation.contactName}</span>
                  <Badge variant="outline" className="shrink-0 text-[10px]">
                    {STATUS_LABELS[conversation.status]}
                  </Badge>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {conversation.lastMessagePreview ?? conversation.contactPhone}
                </p>
              </div>
            </Link>
          );
        })
      )}
    </aside>
  );
}
