"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { getInitials } from "@/lib/format/initials";
import { cn } from "@/lib/utils";
import { ContactDialog } from "@/app/(app)/contatos/contact-dialog";
import { TEMPERATURE_BY_VALUE } from "@/lib/crm/temperature";
import type { ConversationSummary } from "@/lib/inbox/conversation-summary";
import { tagChipStyle } from "./conversation-labels";

export type { ConversationSummary };

export const STATUS_LABELS: Record<ConversationSummary["status"], string> = {
  open: "Aberta",
  pending: "Pendente",
  resolved: "Resolvida",
  closed: "Fechada",
};

export type ConversationResultsProps = {
  conversations: ConversationSummary[];
  /** Muda quando o filtro muda — remonta a área rolável, que volta pro topo. */
  resultKey: string;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  hasActiveFilters: boolean;
  onClear: () => void;
  hrefFor: (conversationId: string) => string;
};

/** Vazio com filtro ("nada bate") é diferente de vazio sem filtro ("não tem conversa"). */
export function EmptyResults({ hasActiveFilters, onClear }: { hasActiveFilters: boolean; onClear: () => void }) {
  if (!hasActiveFilters) {
    return <p className="p-4 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>;
  }
  return (
    <div className="flex flex-col items-start gap-2 p-4">
      <p className="text-sm text-muted-foreground">Nenhuma conversa encontrada com esse filtro.</p>
      <Button type="button" variant="outline" size="sm" onClick={onClear}>
        Limpar filtros
      </Button>
    </div>
  );
}

export function ConversationList({
  conversations,
  resultKey,
  loading,
  error,
  hasMore,
  loadingMore,
  onLoadMore,
  hasActiveFilters,
  onClear,
  hrefFor,
  header,
}: ConversationResultsProps & { header: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border bg-background">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h1 className="text-sm font-semibold">Conversas</h1>
        <ContactDialog
          trigger={
            <Button type="button" variant="ghost" size="icon" className="size-7" title="Novo contato">
              <UserPlus className="size-4" />
            </Button>
          }
        />
      </div>

      {header}

      <div key={resultKey} className="flex-1 overflow-y-auto">
        {error && <p className="px-4 py-2 text-xs text-destructive">{error}</p>}
        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : conversations.length === 0 ? (
          !error && <EmptyResults hasActiveFilters={hasActiveFilters} onClear={onClear} />
        ) : (
          <>
            {conversations.map((conversation) => {
              const isActive = pathname === `/inbox/${conversation.id}`;
              return (
                <Link
                  key={conversation.id}
                  href={hrefFor(conversation.id)}
                  className={cn(
                    "flex items-start gap-2.5 border-b px-4 py-3 text-sm transition-colors hover:bg-muted/50",
                    isActive && "bg-muted",
                  )}
                >
                  <Avatar className="size-8 shrink-0">
                    <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
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
                    {(conversation.temperature || conversation.tags.length > 0) && (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        {conversation.temperature && (
                          <span
                            className={cn(
                              "rounded-full border px-1.5 text-[10px] font-medium",
                              TEMPERATURE_BY_VALUE[conversation.temperature].className,
                            )}
                          >
                            {TEMPERATURE_BY_VALUE[conversation.temperature].label}
                          </span>
                        )}
                        {conversation.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="rounded-full border px-1.5 text-[10px] font-medium"
                            style={tagChipStyle(tag.color)}
                          >
                            {tag.name}
                          </span>
                        ))}
                        {conversation.tags.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{conversation.tags.length - 3}</span>
                        )}
                      </div>
                    )}
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                      {conversation.assignedToMe
                        ? "Com você"
                        : conversation.assignedToName
                          ? `Com ${conversation.assignedToName}`
                          : "Sem responsável"}
                    </p>
                  </div>
                </Link>
              );
            })}
            {hasMore && (
              <div className="p-3">
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={onLoadMore} disabled={loadingMore}>
                  {loadingMore ? "Carregando..." : "Carregar mais"}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
