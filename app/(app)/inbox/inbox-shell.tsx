"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { List, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  filtersToSearchParams,
  parseInboxFilters,
  type InboxFilters,
} from "@/lib/inbox/filters";
import type { ConversationSummary, FilterOptions } from "@/lib/inbox/conversation-summary";
import { ConversationList } from "./conversation-list";
import { ConversationKanban } from "./conversation-kanban";
import { ConversationFilters } from "./conversation-filters";
import { RealtimeListener } from "./realtime-listener";

type ViewMode = "list" | "kanban";
const PAGE_SIZE = 50;

type SearchResult = {
  /** Qual filtro (query string) gerou este resultado — se não bate com a URL atual, está carregando. */
  key: string;
  items: ConversationSummary[];
  total: number;
  byStatus: Partial<Record<ConversationSummary["status"], number>>;
  hasMore: boolean;
};

/**
 * Dono do estado da Inbox: os filtros vivem na URL (recarregar ou colar o
 * link reproduz a mesma lista) e a lista vem do servidor já filtrada
 * (GET /api/inbox/conversations). Lista e Kanban mostram o mesmo resultado.
 */
export function InboxShell({ orgId, children }: { orgId: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<ViewMode>("list");

  const filters = useMemo(() => parseInboxFilters(new URLSearchParams(searchParams.toString())), [searchParams]);
  // Forma canônica: mesma lista de filtros → mesma string, mesmo pedido.
  const queryString = useMemo(() => filtersToSearchParams(filters).toString(), [filters]);

  const [result, setResult] = useState<SearchResult | null>(null);
  // Erro fica preso ao filtro que falhou: trocar de filtro tenta de novo.
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [options, setOptions] = useState<FilterOptions | null>(null);
  // Só a resposta do pedido mais recente vale — filtro trocado rápido não
  // pode deixar uma resposta antiga sobrescrever a nova.
  const latestRequest = useRef(0);
  const loadedCount = useRef(PAGE_SIZE);

  const fetchPage = useCallback(
    async (offset: number, limit: number) => {
      const params = new URLSearchParams(queryString);
      params.set("offset", String(offset));
      params.set("limit", String(limit));
      const response = await fetch(`/api/inbox/conversations?${params}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Não foi possível carregar as conversas.");
      return (await response.json()) as Omit<SearchResult, "key">;
    },
    [queryString],
  );

  /** Recarrega do topo mantendo quantas já estavam carregadas — evento em tempo real. */
  const reload = useCallback(
    async (limit: number) => {
      const requestId = ++latestRequest.current;
      try {
        const page = await fetchPage(0, limit);
        if (requestId !== latestRequest.current) return;
        loadedCount.current = Math.max(PAGE_SIZE, page.items.length);
        setResult({ key: queryString, ...page });
        setError(null);
      } catch (err) {
        if (requestId !== latestRequest.current) return;
        setError({ key: queryString, message: err instanceof Error ? err.message : "Erro ao carregar." });
      }
    },
    [fetchPage, queryString],
  );

  // Filtro mudou: volta pro começo da lista (não soma com a página anterior).
  useEffect(() => {
    const requestId = ++latestRequest.current;
    fetchPage(0, PAGE_SIZE)
      .then((page) => {
        if (requestId !== latestRequest.current) return;
        loadedCount.current = PAGE_SIZE;
        setResult({ key: queryString, ...page });
        setError(null);
      })
      .catch((err: unknown) => {
        if (requestId !== latestRequest.current) return;
        setError({ key: queryString, message: err instanceof Error ? err.message : "Erro ao carregar." });
      });
  }, [fetchPage, queryString]);

  async function loadMore() {
    if (!result || loadingMore) return;
    setLoadingMore(true);
    const requestId = latestRequest.current;
    try {
      const page = await fetchPage(result.items.length, PAGE_SIZE);
      if (requestId !== latestRequest.current) return;
      setResult((prev) => {
        if (!prev) return prev;
        const seen = new Set(prev.items.map((c) => c.id));
        const items = [...prev.items, ...page.items.filter((c) => !seen.has(c.id))];
        loadedCount.current = items.length;
        return { ...prev, items, total: page.total, byStatus: page.byStatus, hasMore: page.hasMore };
      });
    } catch (err) {
      setError({ key: queryString, message: err instanceof Error ? err.message : "Erro ao carregar." });
    } finally {
      setLoadingMore(false);
    }
  }

  const loadOptions = useCallback(() => {
    fetch("/api/inbox/filter-options", { cache: "no-store" })
      .then((response) => (response.ok ? (response.json() as Promise<FilterOptions>) : null))
      .then((body) => {
        if (body) setOptions(body);
      })
      .catch(() => {
        // Sem as opções, os seletores só ficam vazios — a lista continua funcionando.
      });
  }, []);

  useEffect(() => {
    loadOptions();
  }, [loadOptions]);

  // Tempo real: em vez de enfiar a conversa que mudou na lista, refaz a
  // MESMA busca (mesmos filtros, mesma quantidade já carregada). Conversa
  // que não bate com o filtro simplesmente não volta do servidor.
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRealtimeChange = useCallback(
    (table: string) => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        void reload(loadedCount.current);
        if (table === "conversation_tags") loadOptions();
      }, 400);
    },
    [reload, loadOptions],
  );

  const updateFilters = useCallback(
    (next: InboxFilters) => {
      const qs = filtersToSearchParams(next).toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname],
  );
  const clearFilters = useCallback(() => updateFilters(DEFAULT_FILTERS), [updateFilters]);

  const hrefFor = useCallback(
    (id: string) => (queryString ? `/inbox/${id}?${queryString}` : `/inbox/${id}`),
    [queryString],
  );

  const failed = error?.key === queryString ? error.message : null;
  const loading = result?.key !== queryString && !failed;
  const hasActiveFilters = countActiveFilters(filters) > 0 || filters.status !== null;

  const filterPanel = (
    <ConversationFilters
      filters={filters}
      options={options}
      byStatus={loading ? null : (result?.byStatus ?? null)}
      total={loading || result?.key !== queryString ? null : (result?.total ?? null)}
      failed={Boolean(failed)}
      onChange={updateFilters}
      onClear={clearFilters}
    />
  );

  const listProps = {
    conversations: result?.key === queryString ? result.items : [],
    resultKey: queryString,
    loading,
    error: failed,
    hasMore: !loading && Boolean(result?.hasMore),
    loadingMore,
    onLoadMore: loadMore,
    hasActiveFilters,
    onClear: clearFilters,
    hrefFor,
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <RealtimeListener orgId={orgId} onChange={onRealtimeChange} />
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
          <ConversationList {...listProps} header={filterPanel} />
          <div className="flex-1 overflow-hidden rounded-lg border bg-background">{children}</div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-2 overflow-hidden">
          <div className="rounded-lg border bg-background">{filterPanel}</div>
          <div className="flex-1 overflow-hidden">
            <ConversationKanban {...listProps} />
          </div>
        </div>
      )}
    </div>
  );
}
