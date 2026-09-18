import { MessageSquare } from "lucide-react";

export default function InboxPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <MessageSquare className="size-8" />
      <p className="text-sm">Selecione uma conversa à esquerda.</p>
    </div>
  );
}
