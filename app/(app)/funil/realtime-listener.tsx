"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sem UI própria — mesmo padrão de app/(app)/inbox/realtime-listener.tsx.
 * Sem isso, o funil só atualiza quando a própria pessoa arrasta um card;
 * mudança feita por outro vendedor (lead novo, mudança de etapa) só
 * aparecia recarregando a página na mão.
 */
export function RealtimeListener({ orgId }: { orgId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`funil-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `org_id=eq.${orgId}` },
        () => router.refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pipeline_stages", filter: `org_id=eq.${orgId}` },
        () => router.refresh(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  return null;
}
