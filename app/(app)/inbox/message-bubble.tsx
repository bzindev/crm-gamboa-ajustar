import { cn } from "@/lib/utils";

export type MessageItem = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string;
  status: string;
  createdAt: string;
};

const STATUS_DISPLAY: Record<string, { icon: string; label: string; className?: string }> = {
  sent: { icon: "✓", label: "Enviada" },
  delivered: { icon: "✓✓", label: "Entregue" },
  // Igual ao WhatsApp: lida = tique azul, pra não confundir com entregue.
  read: { icon: "✓✓", label: "Lida", className: "font-bold text-blue-800" },
  failed: { icon: "⚠ não entregue", label: "Não entregue", className: "font-semibold text-red-800" },
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
          {isOutbound && STATUS_DISPLAY[message.status] && (
            <span
              title={STATUS_DISPLAY[message.status].label}
              aria-label={STATUS_DISPLAY[message.status].label}
              className={STATUS_DISPLAY[message.status].className}
            >
              {STATUS_DISPLAY[message.status].icon}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
