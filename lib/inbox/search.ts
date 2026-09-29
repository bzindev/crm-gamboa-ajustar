import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { messagePreview } from "@/lib/inbox/message-preview";
import { resolvePeriod, VENDOR_ME, VENDOR_NONE, type InboxFilters } from "@/lib/inbox/filters";
import type { ConversationSummary } from "@/lib/inbox/conversation-summary";

export type ConversationSearchResult = {
  items: ConversationSummary[];
  total: number;
  byStatus: Partial<Record<ConversationSummary["status"], number>>;
  hasMore: boolean;
};

// Formato do jsonb devolvido por fn_search_conversations (migration 0031).
const rowSchema = z.object({
  id: z.string(),
  status: z.enum(["open", "pending", "resolved", "closed"]),
  temperature: z.enum(["hot", "warm", "cold"]).nullable(),
  assigned_to: z.string().nullable(),
  assigned_name: z.string().nullable(),
  contact_name: z.string().nullable(),
  contact_phone: z.string(),
  activity_at: z.string().nullable(),
  last_message: z.object({ type: z.string(), content: z.unknown() }).nullable(),
  tags: z.array(z.object({ id: z.string(), name: z.string(), color: z.string() })),
});
const resultSchema = z.object({
  total: z.number(),
  by_status: z.record(z.string(), z.number()),
  items: z.array(rowSchema),
});

/**
 * Busca a página de conversas com todos os filtros aplicados no banco.
 * `supabase` precisa ser o client da SESSÃO do usuário (não o admin): a
 * função roda com a permissão de quem chamou, e é ela que restringe o
 * vendedor comum às próprias conversas + fila — os filtros daqui são só
 * o pedido, nunca a autorização.
 */
export async function searchConversations(
  supabase: SupabaseClient,
  viewer: { orgId: string; userId: string },
  filters: InboxFilters,
  page: { offset: number; limit: number },
  now: Date = new Date(),
): Promise<ConversationSearchResult> {
  const { from, to } = resolvePeriod(filters, now);
  const assignees = filters.vendors
    .filter((v) => v !== VENDOR_NONE)
    .map((v) => (v === VENDOR_ME ? viewer.userId : v));
  const temperatures = filters.temperatures.filter((t) => t !== "none");
  const digits = filters.q.replace(/\D/g, "");

  const { data, error } = await supabase.rpc("fn_search_conversations", {
    p_org_id: viewer.orgId,
    p_status: filters.status,
    p_temperatures: temperatures.length ? temperatures : null,
    p_include_no_temperature: filters.temperatures.includes("none"),
    p_tag_ids: filters.tagIds.length ? filters.tagIds : null,
    p_tag_mode: filters.tagMode,
    p_assignees: assignees.length ? assignees : null,
    p_include_unassigned: filters.vendors.includes(VENDOR_NONE),
    p_team_ids: filters.teamIds.length ? filters.teamIds : null,
    p_stage_ids: filters.stageIds.length ? filters.stageIds : null,
    p_date_field: filters.dateField,
    p_date_from: from?.toISOString() ?? null,
    p_date_to: to?.toISOString() ?? null,
    p_unread: filters.unread,
    p_awaiting: filters.awaiting,
    p_search: filters.q || null,
    // Só procura no telefone quando há dígitos suficientes pra não casar tudo.
    p_search_digits: digits.length >= 3 ? digits : null,
    p_limit: page.limit,
    p_offset: page.offset,
  });
  if (error) throw new Error(`fn_search_conversations falhou: ${error.code} ${error.message}`);

  const result = resultSchema.parse(data);
  const items: ConversationSummary[] = result.items.map((row) => ({
    id: row.id,
    contactName: row.contact_name ?? row.contact_phone,
    contactPhone: row.contact_phone,
    status: row.status,
    assignedToId: row.assigned_to,
    assignedToMe: row.assigned_to === viewer.userId,
    assignedToName: row.assigned_to ? (row.assigned_name ?? "outro vendedor") : null,
    lastMessagePreview: row.last_message ? messagePreview(row.last_message.type, row.last_message.content) : null,
    lastActivityAt: row.activity_at,
    temperature: row.temperature,
    tags: row.tags,
  }));

  return {
    items,
    total: result.total,
    byStatus: result.by_status,
    hasMore: page.offset + items.length < result.total,
  };
}
