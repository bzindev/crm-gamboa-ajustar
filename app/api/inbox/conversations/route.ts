import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { parseInboxFilters } from "@/lib/inbox/filters";
import { searchConversations } from "@/lib/inbox/search";

const pageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(100_000).catch(0),
  limit: z.coerce.number().int().min(1).max(200).catch(50),
});

/**
 * Lista de Conversas com os filtros da URL (mesmos parâmetros da tela:
 * ?status=open&temp=hot&vendor=me...). A organização vem da sessão, nunca
 * do pedido; quem limita o vendedor comum às próprias conversas é a
 * função no banco (ver lib/inbox/search.ts).
 */
export async function GET(request: NextRequest) {
  const membership = await getActiveOrgMembership();
  if (!membership) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const params = request.nextUrl.searchParams;
  const filters = parseInboxFilters(params);
  const page = pageSchema.parse({ offset: params.get("offset") ?? undefined, limit: params.get("limit") ?? undefined });

  try {
    const supabase = await createClient();
    const result = await searchConversations(supabase, membership, filters, page);
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("[inbox] busca de conversas falhou:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Não foi possível carregar as conversas." }, { status: 500 });
  }
}
