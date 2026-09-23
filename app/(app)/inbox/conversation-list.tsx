"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/format/initials";
import { cn } from "@/lib/utils";
import { ContactDialog } from "@/app/(app)/contatos/contact-dialog";

export type ConversationSummary = {
  id: string;
  contactName: string;
  contactPhone: string;
  status: "open" | "pending" | "resolved" | "closed";
  assignedToId: string | null;
  assignedToMe: boolean;
  assignedToName: string | null;
  lastMessagePreview: string | null;
  lastActivityAt: string | null;
};

const STATUS_LABELS: Record<ConversationSummary["status"], string> = {
  open: "Aberta",
  pending: "Pendente",
  resolved: "Resolvida",
  closed: "Fechada",
};

type TabKey = "all" | ConversationSummary["status"];
const UNASSIGNED = "__unassigned__";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "open", label: "Abertas" },
  { key: "pending", label: "Pendentes" },
  { key: "resolved", label: "Resolvidas" },
  { key: "closed", label: "Fechadas" },
];

export function ConversationList({ conversations }: { conversations: ConversationSummary[] }) {
  const pathname = usePathname();
  const [activeTab, setActiveTab] = useState<TabKey>("all");
  const [vendorFilter, setVendorFilter] = useState<string>("all");

  const countByTab = useMemo(() => {
    const counts: Record<TabKey, number> = { all: conversations.length, open: 0, pending: 0, resolved: 0, closed: 0 };
    for (const c of conversations) counts[c.status] += 1;
    return counts;
  }, [conversations]);

  const vendorOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of conversations) {
      if (c.assignedToId && c.assignedToName) seen.set(c.assignedToId, c.assignedToName);
    }
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [conversations]);

  const byStatus =
    activeTab === "all" ? conversations : conversations.filter((c) => c.status === activeTab);
  const filtered =
    vendorFilter === "all"
      ? byStatus
      : vendorFilter === UNASSIGNED
        ? byStatus.filter((c) => !c.assignedToId)
        : byStatus.filter((c) => c.assignedToId === vendorFilter);

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

      <div className="flex gap-1.5 overflow-x-auto border-b px-3 py-2">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              activeTab === tab.key
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70",
            )}
          >
            {tab.label}
            {countByTab[tab.key] > 0 && (
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px]",
                  activeTab === tab.key ? "bg-primary-foreground/20" : "bg-background",
                )}
              >
                {countByTab[tab.key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {vendorOptions.length > 0 && (
        <div className="border-b px-3 py-2">
          <select
            value={vendorFilter}
            onChange={(e) => setVendorFilter(e.target.value)}
            className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
          >
            <option value="all">Todos os vendedores</option>
            <option value={UNASSIGNED}>Sem vendedor</option>
            {vendorOptions.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nenhuma conversa aqui.</p>
        ) : (
          filtered.map((conversation) => {
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
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground/70">
                    {conversation.assignedToMe
                      ? "Com você"
                      : conversation.assignedToName
                        ? `Com ${conversation.assignedToName}`
                        : "Sem responsável"}
                  </p>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </aside>
  );
}
