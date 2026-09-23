import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * contacts.opted_in é o que a tela mostra; consents é o que o disparo em
 * massa realmente consulta (tem histórico — quando consentiu, quando
 * revogou — que a LGPD exige e um booleano sozinho não guarda). Uma ação
 * só, pra nunca ficar um sem o outro.
 */
export async function syncConsent(
  supabase: SupabaseClient,
  params: { orgId: string; contactId: string; optedIn: boolean },
): Promise<void> {
  // Confirma que o contato é desta organização antes de gravar qualquer
  // coisa — defesa em profundidade: mesmo que algum chamador esqueça de
  // checar isso antes (já aconteceu, ver correção de segurança em
  // lib/actions/contacts.ts), não dá pra criar consentimento pra contato
  // de outra organização por aqui.
  const { data: contact } = await supabase
    .from("contacts")
    .select("id")
    .eq("id", params.contactId)
    .eq("org_id", params.orgId)
    .maybeSingle();
  if (!contact) return;

  await supabase
    .from("contacts")
    .update({ opted_in: params.optedIn, opted_out_at: params.optedIn ? null : new Date().toISOString() })
    .eq("id", params.contactId)
    .eq("org_id", params.orgId);

  if (params.optedIn) {
    const { data: existing } = await supabase
      .from("consents")
      .select("id")
      .eq("org_id", params.orgId)
      .eq("contact_id", params.contactId)
      .is("revoked_at", null)
      .maybeSingle();

    if (!existing) {
      await supabase.from("consents").insert({
        org_id: params.orgId,
        contact_id: params.contactId,
        source: "manual",
      });
    }
  } else {
    await supabase
      .from("consents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("org_id", params.orgId)
      .eq("contact_id", params.contactId)
      .is("revoked_at", null);
  }
}
