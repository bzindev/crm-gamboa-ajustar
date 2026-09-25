"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const REFRESH_DEBOUNCE_MS = 2000;

/**
 * Mesmo padrão dos listeners do Inbox e do Funil, com uma diferença: o
 * dashboard refaz várias consultas pesadas a cada render, então várias
 * mudanças em sequência (ex.: uma rajada de mensagens) viram UM refresh só
 * depois de 2s de calma, em vez de um por evento.
 */
export function DashboardRealtimeListener({ orgId }: { orgId: string }) {
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), REFRESH_DEBOUNCE_MS);
    };

    const supabase = createClient();
    const filter = `org_id=eq.${orgId}`;
    const channel = supabase
      .channel(`dashboard-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter }, scheduleRefresh)
      .subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  return null;
}
