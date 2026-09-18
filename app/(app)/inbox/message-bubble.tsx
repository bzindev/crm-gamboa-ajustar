import { cn } from "@/lib/utils";

export type MessageItem = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string;
  status: string;
  createdAt: string;
};

const STATUS_ICON: Record<string, string> = {
  sent: "✓",
  delivered: "✓✓",
  read: "✓✓",
  failed: "!",
};

export function MessageBubble({ message }: { message: MessageItem }) {
  const isOutbound = message.direction === "outbound";
  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[70%] rounded-lg px-3 py-2 text-sm shadow-sm",
          isOutbound ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        <p className="whitespace-pre-wrap break-words">{message.body}</p>
        <div
          className={cn(
            "mt-1 flex items-center justify-end gap-1 text-[10px]",
            isOutbound ? "text-primary-foreground/70" : "text-muted-foreground",
          )}
        >
          {new Date(message.createdAt).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}
          {isOutbound && <span>{STATUS_ICON[message.status] ?? ""}</span>}
        </div>
      </div>
    </div>
  );
}
