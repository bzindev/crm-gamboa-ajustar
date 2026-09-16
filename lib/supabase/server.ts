import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Client de servidor: propaga o JWT do usuário autenticado via cookies
 * HttpOnly. É esse JWT que a RLS do Postgres inspeciona em cada query —
 * por isso toda leitura/escrita de dado de organização deve passar por
 * este client, nunca pelo client de service role (ver lib/supabase/admin.ts).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Chamado a partir de um Server Component (sem permissão de
            // escrever cookie) — o middleware já cuida de renovar a sessão
            // nesse caso, então é seguro ignorar aqui.
          }
        },
      },
    },
  );
}
