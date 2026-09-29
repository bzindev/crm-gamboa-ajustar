import { FileText, MapPin, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes, mapsUrl } from "@/lib/whatsapp/media-rules";

export type MessageItem = {
  id: string;
  direction: "inbound" | "outbound";
  type: string;
  body: string;
  status: string;
  createdAt: string;
  /** url nula = arquivo indisponível (download da Meta falhou ou link não gerado). */
  media?: { url: string | null; mime: string; filename: string; size: number | null } | null;
  location?: { latitude: number; longitude: number; name?: string | null; address?: string | null } | null;
};

const STATUS_DISPLAY: Record<string, { icon: string; label: string; className?: string }> = {
  sent: { icon: "✓", label: "Enviada" },
  delivered: { icon: "✓✓", label: "Entregue" },
  // Igual ao WhatsApp: lida = tique azul, pra não confundir com entregue.
  read: { icon: "✓✓", label: "Lida", className: "font-bold text-blue-800" },
  failed: { icon: "⚠ não entregue", label: "Não entregue", className: "font-semibold text-red-800" },
};

function MediaView({ message, isOutbound }: { message: MessageItem; isOutbound: boolean }) {
  const media = message.media!;
  if (!media.url) {
    return <p className="text-xs italic opacity-80">Arquivo indisponível ({media.filename})</p>;
  }

  /* Links assinados do Storage, externos e temporários — next/image não agrega aqui. */
  if (message.type === "image" || message.type === "sticker") {
    return (
      <a href={media.url} target="_blank" rel="noopener noreferrer" className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={media.url}
          alt={media.filename}
          className={cn("max-h-72 rounded-md object-contain", message.type === "sticker" && "max-h-32")}
        />
      </a>
    );
  }
  if (message.type === "video") {
    return <video src={media.url} controls className="max-h-72 rounded-md" />;
  }
  if (message.type === "audio") {
    return <audio src={media.url} controls className="max-w-full" />;
  }
  return (
    <a
      href={media.url}
      target="_blank"
      rel="noopener noreferrer"
      download={media.filename}
      className={cn(
        "flex items-center gap-2 rounded-md border px-3 py-2",
        isOutbound ? "border-primary-foreground/20 bg-primary-foreground/10" : "border-border bg-background/50",
      )}
    >
      <FileText className="size-5 shrink-0" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{media.filename}</span>
        {media.size !== null && <span className="text-xs opacity-80">{formatBytes(media.size)}</span>}
      </span>
      <Download className="size-4 shrink-0" />
    </a>
  );
}

export function MessageBubble({ message }: { message: MessageItem }) {
  const isOutbound = message.direction === "outbound";
  const location = message.location;
  return (
    <div className={cn("flex", isOutbound ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "flex max-w-[70%] flex-col gap-1.5 rounded-lg px-3 py-2 text-sm shadow-sm",
          isOutbound ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {message.media && <MediaView message={message} isOutbound={isOutbound} />}

        {location && (
          <a
            href={mapsUrl(location.latitude, location.longitude)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-2 hover:underline"
          >
            <MapPin className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="block font-medium">{location.name || "Localização"}</span>
              {location.address && <span className="block text-xs opacity-80">{location.address}</span>}
              <span className="block text-xs opacity-80">Abrir no mapa</span>
            </span>
          </a>
        )}

        {message.body && <p className="whitespace-pre-wrap break-words">{message.body}</p>}

        <div
          className={cn(
            "flex items-center justify-end gap-1 text-[10px]",
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
