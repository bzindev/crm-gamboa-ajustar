import { Skeleton } from "@/components/ui/skeleton";

export default function InboxLoading() {
  return (
    <div className="flex h-full gap-4">
      <aside className="flex w-80 shrink-0 flex-col gap-3 rounded-lg border bg-background p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </aside>
      <div className="flex-1 rounded-lg border bg-background" />
    </div>
  );
}
