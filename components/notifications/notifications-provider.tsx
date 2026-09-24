"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getUnreadConversationCount } from "@/lib/actions/notifications";

const PERMISSION_ASKED_KEY = "notif_permission_asked";
const BASE_TITLE = "CRM";

type NotificationRow = {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
};

type NotificationsContextValue = {
  setActiveConversationId: (id: string | null) => void;
  refreshUnreadCount: () => void;
};

const NotificationsContext = createContext<NotificationsContextValue>({
  setActiveConversationId: () => {},
  refreshUnreadCount: () => {},
});

/** Usado pela conversa aberta pra se marcar como "em foco" e por quem pediu leitura. */
export function useConversationPresence() {
  return useContext(NotificationsContext);
}

/**
 * Sem UI própria — cobre os 3 gatilhos de notificação (lead atribuído,
 * mensagem nova, SLA estourado) escutando a MESMA tabela `notifications`
 * que já alimenta o sino do topbar (lib/notifications/create.ts grava lá
 * nos 3 casos), em vez de ter uma assinatura Realtime por gatilho. Também
 * mantém o contador de não lidas no título da aba.
 */
export function NotificationsProvider({
  userId,
  children,
}: {
  userId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const activeConversationIdRef = useRef<string | null>(null);

  const setActiveConversationId = useCallback((id: string | null) => {
    activeConversationIdRef.current = id;
  }, []);

  const refreshUnreadCount = useCallback(() => {
    getUnreadConversationCount().then((count) => {
      document.title = count > 0 ? `(${count > 99 ? "99+" : count}) ${BASE_TITLE}` : BASE_TITLE;
    });
  }, []);

  useEffect(() => {
    refreshUnreadCount();
  }, [refreshUnreadCount]);

  // Pede permissão só uma vez por navegador, no primeiro login — nunca de
  // novo depois (nem se a pessoa recusou), pra não incomodar a cada visita.
  useEffect(() => {
    try {
      if (
        typeof Notification !== "undefined" &&
        Notification.permission === "default" &&
        !localStorage.getItem(PERMISSION_ASKED_KEY)
      ) {
        localStorage.setItem(PERMISSION_ASKED_KEY, "1");
        void Notification.requestPermission();
      }
    } catch {
      // Notification API ausente (navegador antigo) ou localStorage
      // bloqueado (aba anônima) — sem notificação nativa, sem quebrar o app.
    }
  }, []);

  useEffect(() => {
    // Se o usuário já está com a conversa daquele link aberta e em foco na
    // tela, não dispara — ele já está vendo. Fora desse caso, mostra.
    function fireNotification(row: NotificationRow) {
      const conversationMatch = row.link?.match(/^\/inbox\/([^/]+)$/);
      const isLookingAtIt =
        document.hasFocus() && !!conversationMatch && activeConversationIdRef.current === conversationMatch[1];
      if (isLookingAtIt) return;

      try {
        if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
        const notification = new Notification(row.title, { body: row.body ?? undefined });
        notification.onclick = () => {
          window.focus();
          if (row.link) router.push(row.link);
          notification.close();
        };
      } catch {
        // Best-effort — navegador sem suporte, ou instância bloqueada.
      }
    }

    const supabase = createClient();
    const channel = supabase
      .channel(`notifications-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as NotificationRow;
          fireNotification(row);
          refreshUnreadCount();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, router, refreshUnreadCount]);

  return (
    <NotificationsContext.Provider value={{ setActiveConversationId, refreshUnreadCount }}>
      {children}
    </NotificationsContext.Provider>
  );
}
