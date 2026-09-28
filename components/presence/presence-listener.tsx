"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** "Offline" é derivado de last_active_at (sem sinal há 3 min) — não gera evento nenhum, só um refresh periódico pega. */
const OFFLINE_RECHECK_MS = 60_000;

/**
 * Montado só na tela que mostra presença (Configurações → Equipe). Antes
 * ficava no layout do app inteiro e recarregava TODA tela de TODO usuário
 * a cada heartbeat de qualquer colega (1 por minuto por pessoa) — com 10
 * vendedores, ~10 recargas por minuto em cada aba, à toa. Agora só
 * recarrega quando o status de alguém muda de fato (o heartbeat que só
 * atualiza last_active_at não conta).
 */
export function PresenceListener() {
  const router = useRouter();

  useEffect(() => {
    const lastStatus = new Map<string, string>();
    const supabase = createClient();
    const channel = supabase
      .channel("presence-profiles")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        (payload) => {
          const row = payload.new as { id?: string; presence_status?: string };
          if (!row.id || !row.presence_status) return;
          const previous = lastStatus.get(row.id);
          lastStatus.set(row.id, row.presence_status);
          if (previous !== row.presence_status) router.refresh();
        },
      )
      .subscribe();

    const interval = setInterval(() => router.refresh(), OFFLINE_RECHECK_MS);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
