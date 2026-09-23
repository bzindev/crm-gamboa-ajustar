"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PresenceDot } from "@/components/presence/presence-dot";
import { getInitials } from "@/lib/format/initials";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { cn } from "@/lib/utils";

export type MonitorConversation = {
  id: string;
  contactName: string;
  contactPhone: string;
  status: "open" | "pending" | "resolved" | "closed";
  teamName: string | null;
  assignedName: string | null;
  assignedPresenceStatus: string | null;
  assignedLastActiveAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: "inbound" | "outbound" | null;
  lastActivityAt: string | null;
};

const STATUS_LABELS: Record<MonitorConversation["status"], string> = {
  open: "Aberta",
  pending: "Pendente",
  resolved: "Resolvida",
  closed: "Fechada",
};

const STATUS_VARIANT: Record<MonitorConversation["status"], "default" | "secondary" | "outline"> = {
  open: "default",
  pending: "secondary",
  resolved: "outline",
  closed: "outline",
};

type TabKey = "all" | MonitorConversation["status"] | "unassigned";

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "Todas" },
  { key: "unassigned", label: "Sem vendedor" },
  { key: "open", label: "Abertas" },
  { key: "pending", label: "Pendentes" },
  { key: "resolved", label: "Resolvidas" },
  { key: "closed", label: "Fechadas" },
];

export function MonitorView({ conversations }: { conversations: MonitorConversation[] }) {
  const [activeTab, setActiveTab] = useState<TabKey>("all");

  const summary = useMemo(
    () => ({
      total: conversations.length,
      unassigned: conversations.filter((c) => !c.assignedName).length,
      open: conversations.filter((c) => c.status === "open").length,
    }),
    [conversations],
  );

  const filtered = useMemo(() => {
    if (activeTab === "all") return conversations;
    if (activeTab === "unassigned") return conversations.filter((c) => !c.assignedName);
    return conversations.filter((c) => c.status === activeTab);
  }, [conversations, activeTab]);

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-hidden">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Conversas no total</CardDescription>
            <CardTitle className="text-2xl">{summary.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Sem vendedor</CardDescription>
            <CardTitle className="text-2xl text-destructive">{summary.unassigned}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Abertas</CardDescription>
            <CardTitle className="text-2xl">{summary.open}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      <div className="flex gap-1.5 overflow-x-auto">
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
          </button>
        ))}
      </div>

      <Card className="flex-1 overflow-hidden">
        <CardContent className="h-full overflow-y-auto p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cliente</TableHead>
                <TableHead>Setor</TableHead>
                <TableHead>Vendedor</TableHead>
                <TableHead>Última mensagem</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((conversation) => (
                <TableRow key={conversation.id}>
                  <TableCell>
                    <p className="font-medium">{conversation.contactName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{conversation.contactPhone}</p>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {conversation.teamName ?? "—"}
                  </TableCell>
                  <TableCell>
                    {conversation.assignedName ? (
                      <div className="flex items-center gap-2">
                        <div className="relative shrink-0">
                          <Avatar className="size-6">
                            <AvatarFallback className="bg-primary text-[10px] font-semibold text-primary-foreground">
                              {getInitials(conversation.assignedName)}
                            </AvatarFallback>
                          </Avatar>
                          <PresenceDot
                            presenceStatus={conversation.assignedPresenceStatus}
                            lastActiveAt={conversation.assignedLastActiveAt}
                            className="absolute -right-0.5 -bottom-0.5"
                          />
                        </div>
                        <span className="text-sm">{conversation.assignedName}</span>
                      </div>
                    ) : (
                      <Badge variant="destructive">Sem vendedor</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <p className="truncate text-sm">
                      {conversation.lastMessageDirection === "outbound" && (
                        <span className="text-muted-foreground">Vendedor: </span>
                      )}
                      {conversation.lastMessageDirection === "inbound" && (
                        <span className="text-muted-foreground">Cliente: </span>
                      )}
                      {conversation.lastMessagePreview ?? "Nenhuma mensagem ainda"}
                    </p>
                    {conversation.lastActivityAt && (
                      <p className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(conversation.lastActivityAt)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANT[conversation.status]}>
                      {STATUS_LABELS[conversation.status]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Link href={`/inbox/${conversation.id}`} className="text-sm text-primary hover:underline">
                      Abrir
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    Nenhuma conversa aqui.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
