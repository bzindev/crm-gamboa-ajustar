import type { Temperature } from "@/lib/crm/temperature";

/** Uma linha da lista/Kanban de Conversas — o que o endpoint de busca devolve. */
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
  temperature: Temperature | null;
  tags: { id: string; name: string; color: string }[];
};

/** Opções dos seletores de filtro — o que GET /api/inbox/filter-options devolve. */
export type FilterOptions = {
  viewer: { id: string; role: string };
  tags: { id: string; name: string; color: string }[];
  members: { id: string; name: string }[];
  teams: { id: string; name: string }[];
  stages: { id: string; name: string; pipeline: string }[];
};
