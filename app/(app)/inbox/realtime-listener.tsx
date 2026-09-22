"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sem UI própria — só mantém uma assinatura Realtime aberta e manda o
 * Next.js buscar dados novos do servidor quando `messages`/`conversations`
 * mudam. `router.refresh()` re-executa os Server Components da rota atual
 * (lista + thread aberta), então não precisa reconciliar estado no cliente
 * à mão. Migration 0012 precisa estar aplicada (`alter publication
 * supabase_realtime add table ...`) para esses eventos chegarem aqui.
 */
export function RealtimeListener({ orgId }: { orgId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`inbox-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `org_id=eq.${orgId}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `org_id=eq.${orgId}` },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  return null;
}
