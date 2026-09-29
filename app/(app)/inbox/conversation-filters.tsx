"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { TEMPERATURES } from "@/lib/crm/temperature";
import {
  CONVERSATION_STATUSES,
  DATE_FIELD_LABELS,
  DATE_FIELDS,
  PERIOD_LABELS,
  PERIODS,
  VENDOR_ME,
  VENDOR_NONE,
  countActiveFilters,
  type DateField,
  type InboxFilters,
  type Period,
  type TemperatureFilter,
} from "@/lib/inbox/filters";
import type {
  ConversationSummary,
  FilterOptions,
} from "@/lib/inbox/conversation-summary";

const TAB_LABELS: Record<ConversationSummary["status"], string> = {
  open: "Abertas",
  pending: "Pendentes",
  resolved: "Resolvidas",
  closed: "Fechadas",
};

/** Liga/desliga um valor numa lista (seleção múltipla). */
function toggle<T>(list: T[], value: T, on: boolean): T[] {
  return on
    ? list.includes(value)
      ? list
      : [...list, value]
    : list.filter((v) => v !== value);
}

/** Botão de cada seletor: mostra "(2)" e fica destacado quando tem seleção. */
function FilterMenu({
  label,
  count,
  children,
  className,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs transition-colors",
            count > 0
              ? "border-primary/60 bg-primary/10 font-medium text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
          {count > 0 && ` (${count})`}
          <ChevronDown className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={cn("w-60", className)}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Item com caixinha que não fecha o menu ao clicar (dá pra marcar vários). */
function CheckItem({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={(value) => onChange(value === true)}
      onSelect={(e) => e.preventDefault()}
    >
      {children}
    </DropdownMenuCheckboxItem>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "h-7 rounded-full border px-2.5 text-xs transition-colors",
        active
          ? "border-primary/60 bg-primary/10 font-medium text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

// O menu captura as teclas pra navegação — sem isso, digitar uma letra no
// campo de busca/data pulava pro item que começa com ela.
const stopMenuKeys = (e: React.KeyboardEvent) => e.stopPropagation();

export function ConversationFilters({
  filters,
  options,
  byStatus,
  total,
  failed,
  onChange,
  onClear,
}: {
  filters: InboxFilters;
  options: FilterOptions | null;
  /** null enquanto carrega. */
  byStatus: Partial<Record<ConversationSummary["status"], number>> | null;
  total: number | null;
  /** A busca falhou — mostra isso em vez de "Carregando...". */
  failed: boolean;
  onChange: (filters: InboxFilters) => void;
  onClear: () => void;
}) {
  const set = (patch: Partial<InboxFilters>) =>
    onChange({ ...filters, ...patch });

  // Busca: digita livre e só manda pra URL depois de uma pausa. Quando a URL
  // muda por fora (ex.: "Limpar filtros"), o campo acompanha.
  const [text, setText] = useState(filters.q);
  const [syncedQ, setSyncedQ] = useState(filters.q);
  if (filters.q !== syncedQ) {
    setSyncedQ(filters.q);
    // Não sobrescreve o que está sendo digitado (ex.: o espaço no fim de "João ").
    if (filters.q !== text.trim()) setText(filters.q);
  }
  useEffect(() => {
    const trimmed = text.trim();
    if (trimmed === filters.q) return;
    const timer = setTimeout(() => onChange({ ...filters, q: trimmed }), 350);
    return () => clearTimeout(timer);
  }, [text, filters, onChange]);

  const [tagQuery, setTagQuery] = useState("");
  // Seletores recolhidos por padrão pra sobrar espaço pra lista — o botão
  // "Filtros (N)" mostra quantos estão ligados mesmo com a gaveta fechada.
  const [expanded, setExpanded] = useState(false);

  const isAgent = options?.viewer.role === "agent";
  const colleagues = (options?.members ?? []).filter(
    (m) => m.id !== options?.viewer.id,
  );
  const visibleTags = (options?.tags ?? []).filter((t) =>
    t.name.toLowerCase().includes(tagQuery.trim().toLowerCase()),
  );
  const allCount = byStatus
    ? Object.values(byStatus).reduce((sum, n) => sum + (n ?? 0), 0)
    : null;
  const activeCount = countActiveFilters(filters);

  return (
    <div className="flex flex-col border-b">
      <div className="px-3 pt-2">
        <div className="relative">
          <Search className="absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Buscar por nome ou telefone"
            aria-label="Buscar conversas"
            maxLength={100}
            className="h-8 w-full rounded-md border bg-transparent pr-7 pl-7 text-xs"
          />
          {text && (
            <button
              type="button"
              onClick={() => setText("")}
              className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Limpar busca"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {[null, ...CONVERSATION_STATUSES].map((status) => {
          const active = filters.status === status;
          const count = status === null ? allCount : (byStatus?.[status] ?? 0);
          return (
            <button
              key={status ?? "all"}
              type="button"
              onClick={() => set({ status })}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/70",
              )}
            >
              {status === null ? "Todas" : TAB_LABELS[status]}
              {count !== null && count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px]",
                    active ? "bg-primary-foreground/20" : "bg-background",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-2 px-3 pb-2 text-xs text-muted-foreground">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls="inbox-filter-drawer"
          className={cn(
            "flex h-7 items-center gap-1.5 rounded-full border px-2.5 transition-colors",
            activeCount > 0
              ? "border-primary/60 bg-primary/10 font-medium text-foreground"
              : "hover:text-foreground",
          )}
        >
          <SlidersHorizontal className="size-3.5" />
          Filtros{activeCount > 0 && ` (${activeCount})`}
          <ChevronDown
            className={cn(
              "size-3 transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
        <div className="flex items-center gap-1">
          <span>
            {failed
              ? "Não foi possível carregar"
              : total === null
                ? "Carregando..."
                : `${total} ${total === 1 ? "conversa" : "conversas"}`}
          </span>
          {(activeCount > 0 || filters.status !== null) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onClear}
            >
              Limpar
            </Button>
          )}
        </div>
      </div>

      {/* Gaveta: grid 0fr→1fr anima a altura sem precisar medir o conteúdo. */}
      <div
        id="inbox-filter-drawer"
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
        inert={!expanded}
      >
        <div className="overflow-hidden">
          <div className="flex flex-wrap gap-1.5 px-3 pb-2">
            <FilterMenu label="Temperatura" count={filters.temperatures.length}>
              {TEMPERATURES.map((t) => (
                <CheckItem
                  key={t.value}
                  checked={filters.temperatures.includes(t.value)}
                  onChange={(on) =>
                    set({
                      temperatures: toggle<TemperatureFilter>(
                        filters.temperatures,
                        t.value,
                        on,
                      ),
                    })
                  }
                >
                  {t.label}
                </CheckItem>
              ))}
              <CheckItem
                checked={filters.temperatures.includes("none")}
                onChange={(on) =>
                  set({
                    temperatures: toggle<TemperatureFilter>(
                      filters.temperatures,
                      "none",
                      on,
                    ),
                  })
                }
              >
                Sem temperatura
              </CheckItem>
            </FilterMenu>

            <FilterMenu
              label="Etiquetas"
              count={filters.tagIds.length}
              className="w-64"
            >
              <div className="flex gap-1 p-1">
                {(["any", "all"] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => set({ tagMode: mode })}
                    className={cn(
                      "flex-1 rounded-md px-2 py-1 text-xs",
                      filters.tagMode === mode
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {mode === "any" ? "Qualquer uma" : "Todas"}
                  </button>
                ))}
              </div>
              <div className="p-1">
                <input
                  value={tagQuery}
                  onChange={(e) => setTagQuery(e.target.value)}
                  onKeyDown={stopMenuKeys}
                  placeholder="Buscar etiqueta"
                  className="h-8 w-full rounded-md border bg-transparent px-2 text-xs"
                />
              </div>
              <DropdownMenuSeparator />
              <div className="max-h-60 overflow-y-auto">
                {visibleTags.map((tag) => (
                  <CheckItem
                    key={tag.id}
                    checked={filters.tagIds.includes(tag.id)}
                    onChange={(on) =>
                      set({ tagIds: toggle(filters.tagIds, tag.id, on) })
                    }
                  >
                    <span
                      className="size-2.5 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.name}
                  </CheckItem>
                ))}
                {options && visibleTags.length === 0 && (
                  <p className="px-2 py-1.5 text-xs text-muted-foreground">
                    Nenhuma etiqueta encontrada.
                  </p>
                )}
              </div>
            </FilterMenu>

            <FilterMenu
              label={isAgent ? "Responsável" : "Vendedor"}
              count={filters.vendors.length}
            >
              <CheckItem
                checked={filters.vendors.includes(VENDOR_ME)}
                onChange={(on) =>
                  set({ vendors: toggle(filters.vendors, VENDOR_ME, on) })
                }
              >
                Comigo
              </CheckItem>
              <CheckItem
                checked={filters.vendors.includes(VENDOR_NONE)}
                onChange={(on) =>
                  set({ vendors: toggle(filters.vendors, VENDOR_NONE, on) })
                }
              >
                Sem responsável (fila)
              </CheckItem>
              {!isAgent && colleagues.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="max-h-60 overflow-y-auto">
                    {colleagues.map((member) => (
                      <CheckItem
                        key={member.id}
                        checked={filters.vendors.includes(member.id)}
                        onChange={(on) =>
                          set({
                            vendors: toggle(filters.vendors, member.id, on),
                          })
                        }
                      >
                        {member.name}
                      </CheckItem>
                    ))}
                  </div>
                </>
              )}
            </FilterMenu>

            <FilterMenu
              label="Período"
              count={filters.period ? 1 : 0}
              className="w-64"
            >
              <DropdownMenuLabel className="text-xs">
                Filtrar pela data de
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={filters.dateField}
                onValueChange={(v) => set({ dateField: v as DateField })}
              >
                {DATE_FIELDS.map((field) => (
                  <DropdownMenuRadioItem
                    key={field}
                    value={field}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {DATE_FIELD_LABELS[field]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup
                value={filters.period ?? "any"}
                onValueChange={(v) =>
                  v === "any"
                    ? set({ period: null, from: null, to: null })
                    : set({
                        period: v as Period,
                        ...(v === "custom" ? {} : { from: null, to: null }),
                      })
                }
              >
                <DropdownMenuRadioItem
                  value="any"
                  onSelect={(e) => e.preventDefault()}
                >
                  Qualquer data
                </DropdownMenuRadioItem>
                {PERIODS.map((period) => (
                  <DropdownMenuRadioItem
                    key={period}
                    value={period}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {PERIOD_LABELS[period]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {filters.period === "custom" && (
                <div className="grid grid-cols-2 gap-1.5 p-1">
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    De
                    <input
                      type="date"
                      value={filters.from ?? ""}
                      max={filters.to ?? undefined}
                      onChange={(e) => set({ from: e.target.value || null })}
                      onKeyDown={stopMenuKeys}
                      className="h-8 rounded-md border bg-transparent px-1.5 text-xs text-foreground"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                    Até
                    <input
                      type="date"
                      value={filters.to ?? ""}
                      min={filters.from ?? undefined}
                      onChange={(e) => set({ to: e.target.value || null })}
                      onKeyDown={stopMenuKeys}
                      className="h-8 rounded-md border bg-transparent px-1.5 text-xs text-foreground"
                    />
                  </label>
                </div>
              )}
            </FilterMenu>

            {options && options.stages.length > 0 && (
              <FilterMenu
                label="Etapa do funil"
                count={filters.stageIds.length}
              >
                <div className="max-h-60 overflow-y-auto">
                  {options.stages.map((stage) => (
                    <CheckItem
                      key={stage.id}
                      checked={filters.stageIds.includes(stage.id)}
                      onChange={(on) =>
                        set({
                          stageIds: toggle(filters.stageIds, stage.id, on),
                        })
                      }
                    >
                      {stage.name}
                    </CheckItem>
                  ))}
                </div>
              </FilterMenu>
            )}

            {options && options.teams.length > 0 && (
              <FilterMenu label="Setor" count={filters.teamIds.length}>
                {options.teams.map((team) => (
                  <CheckItem
                    key={team.id}
                    checked={filters.teamIds.includes(team.id)}
                    onChange={(on) =>
                      set({ teamIds: toggle(filters.teamIds, team.id, on) })
                    }
                  >
                    {team.name}
                  </CheckItem>
                ))}
              </FilterMenu>
            )}

            <ToggleChip
              active={filters.unread}
              onClick={() => set({ unread: !filters.unread })}
            >
              Não lidas
            </ToggleChip>
            <ToggleChip
              active={filters.awaiting}
              onClick={() => set({ awaiting: !filters.awaiting })}
            >
              Aguardando resposta
            </ToggleChip>
          </div>
        </div>
      </div>
    </div>
  );
}
