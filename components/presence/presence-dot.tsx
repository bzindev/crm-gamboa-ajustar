import { resolvePresenceStatus, PRESENCE_DOT_CLASSNAME, PRESENCE_LABELS } from "@/lib/presence/status";
import { cn } from "@/lib/utils";

export function PresenceDot({
  presenceStatus,
  lastActiveAt,
  className,
}: {
  presenceStatus: string | null | undefined;
  lastActiveAt: string | null | undefined;
  className?: string;
}) {
  const status = resolvePresenceStatus(presenceStatus, lastActiveAt);

  return (
    <span
      title={PRESENCE_LABELS[status]}
      className={cn(
        "block size-2.5 shrink-0 rounded-full ring-2 ring-card",
        PRESENCE_DOT_CLASSNAME[status],
        className,
      )}
    />
  );
}
