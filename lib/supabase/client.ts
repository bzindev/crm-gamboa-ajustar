import { createBrowserClient } from "@supabase/ssr";

/**
 * Client de browser. Usa a anon key (pública por design) — a RLS de cada
 * tabela é a barreira real, não o sigilo dessa chave.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
