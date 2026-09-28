import type { GoalProgress } from "@/lib/crm/goals";
import { formatCents } from "@/lib/format/currency";
import { cn } from "@/lib/utils";

function Bar({ pct }: { pct: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn("h-full rounded-full", pct >= 100 ? "bg-positive" : "bg-primary")}
        style={{ width: `${Math.min(100, Math.max(pct > 0 ? 3 : 0, pct))}%` }}
      />
    </div>
  );
}

/** Sem estado nem evento — pode ser usado direto em Server Component. */
export function GoalProgressList({
  items,
  renderAction,
}: {
  items: GoalProgress[];
  renderAction?: (item: GoalProgress) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {items.map((item) => (
        <div key={item.goalId} className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className={cn("font-medium", item.userId === null && "text-primary")}>{item.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {item.won} de {item.targetWon} vendas · {item.wonPct}%
              </span>
              {renderAction?.(item)}
            </div>
          </div>
          <Bar pct={item.wonPct} />
          {item.targetValueCents !== null && item.valuePct !== null && (
            <div className="flex items-center gap-2">
              <Bar pct={item.valuePct} />
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatCents(item.wonValueCents)} de {formatCents(item.targetValueCents)}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
