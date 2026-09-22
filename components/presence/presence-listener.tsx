"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sem UI própria — mesma ideia de app/(app)/inbox/realtime-listener.tsx:
 * assina mudanças em profiles (presence_status/last_active_at) e manda o
 * Next.js buscar dados novos, pra o pontinho de status de outras pessoas
 * atualizar sem precisar navegar. Precisa da migration 0013 aplicada
 * (profiles já está na tabela padrão de Realtime desde sempre, mas a
 * primeira leitura só funciona se a organização tiver `org_id` acessível
 * via RLS — profiles não tem org_id direto, então o filtro aqui é só uma
 * otimização de rede; a extensão real do "isso é da minha organização" já
 * vem da política de SELECT em profiles).
 */
export function PresenceListener() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("presence-profiles")
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "profiles" },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
