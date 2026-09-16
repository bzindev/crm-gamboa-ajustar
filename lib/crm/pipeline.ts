import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * MVP: uma organização usa o pipeline padrão criado junto com ela (ver
 * fn_create_organization). Múltiplos pipelines por organização ficam para
 * quando/se surgir a necessidade — não vale a complexidade agora.
 */
export async function getDefaultPipelineId(
  supabase: SupabaseClient,
  orgId: string,
): Promise<string> {
  const { data, error } = await supabase
    .from("pipelines")
    .select("id")
    .eq("org_id", orgId)
    .eq("is_default", true)
    .single();

  if (error || !data) {
    throw new Error("Pipeline padrão não encontrado para esta organização.");
  }

  return data.id;
}
