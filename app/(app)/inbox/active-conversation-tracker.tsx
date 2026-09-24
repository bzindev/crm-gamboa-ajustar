"use client";

import { useEffect } from "react";
import { useConversationPresence } from "@/components/notifications/notifications-provider";
import { markConversationRead } from "@/lib/actions/conversations";

/**
 * Sem UI própria. Registra qual conversa está aberta agora (pra o provider
 * de notificações não disparar notificação nativa redundante de uma
 * mensagem que a pessoa já está vendo) e marca como lida — no servidor,
 * markConversationRead só grava de fato se quem chamou for o responsável
 * pela conversa, então um gestor só acompanhando não "read" a conversa de
 * outro vendedor.
 */
export function ActiveConversationTracker({ conversationId }: { conversationId: string }) {
  const { setActiveConversationId, refreshUnreadCount } = useConversationPresence();

  useEffect(() => {
    setActiveConversationId(conversationId);
    markConversationRead(conversationId).then(refreshUnreadCount);

    function onFocus() {
      markConversationRead(conversationId).then(refreshUnreadCount);
    }
    window.addEventListener("focus", onFocus);

    return () => {
      window.removeEventListener("focus", onFocus);
      setActiveConversationId(null);
    };
  }, [conversationId, setActiveConversationId, refreshUnreadCount]);

  return null;
}
