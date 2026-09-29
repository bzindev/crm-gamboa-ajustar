"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/**
 * Sem UI própria — mantém uma assinatura Realtime aberta. A cada mudança em
 * `messages`/`conversations`/`conversation_tags`:
 *   - `router.refresh()` re-executa os Server Components (thread aberta);
 *   - `onChange` avisa a lista, que refaz a busca com os filtros ativos
 *     (a lista não é mais Server Component — vem de /api/inbox/conversations).
 * Migration 0012 precisa estar aplicada (`alter publication
 * supabase_realtime add table ...`) para esses eventos chegarem aqui.
 */
export function RealtimeListener({ orgId, onChange }: { orgId: string; onChange: (table: string) => void }) {
  const router = useRouter();
  // Ref pra não reabrir a assinatura toda vez que o callback muda (muda a
  // cada troca de filtro).
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    const supabase = createClient();
    const handle = (table: string) => () => {
      router.refresh();
      onChangeRef.current(table);
    };
    const channel = supabase
      .channel(`inbox-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "messages", filter: `org_id=eq.${orgId}` }, handle("messages"))
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `org_id=eq.${orgId}` },
        handle("conversations"),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_tags", filter: `org_id=eq.${orgId}` },
        handle("conversation_tags"),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orgId, router]);

  return null;
}
