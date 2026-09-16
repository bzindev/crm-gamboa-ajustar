import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Client com a service role: ignora RLS por completo. Só para os poucos
 * pontos que legitimamente precisam disso (worker de fila, aceitar convite
 * por token, futuras rotas de admin) — e cada um desses pontos filtra
 * org_id/token manualmente no código, nunca confiando em RLS para isso.
 *
 * `server-only` faz o build falhar se este arquivo for importado, direta
 * ou indiretamente, por código que vai para o bundle do browser.
 */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
