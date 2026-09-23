"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { createCampaignSchema } from "@/lib/validation/campaigns";

export type CampaignActionState = { error?: string } | null;

export async function createCampaign(
  _prevState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  let membership;
  try {
    // Manager+ pode disparar usando um template já aprovado — a parte
    // sensível (submeter template novo pra Meta) é admin-only em
    // lib/actions/templates.ts.
    membership = await requireRole("manager");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = createCampaignSchema.safeParse({
    name: formData.get("name"),
    templateId: formData.get("templateId"),
    contactIds: formData.getAll("contactIds"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();

  const { data: template } = await supabase
    .from("message_templates")
    .select("id, status")
    .eq("id", parsed.data.templateId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!template) return { error: "Template não encontrado." };
  if (template.status !== "approved") {
    return { error: "Esse template ainda não foi aprovado pela Meta." };
  }

  // Nunca confia no array de contactIds vindo do form sem checar contra a
  // organização — sem isso, um id de contato de outra organização entraria
  // direto na campanha (a checagem de consents abaixo sozinha não bastava:
  // ela só olha se existe consentimento pra aquele id, não se o contato é
  // desta organização).
  const { data: ownContacts } = await supabase
    .from("contacts")
    .select("id")
    .eq("org_id", membership.orgId)
    .in("id", parsed.data.contactIds);

  const contactIds = parsed.data.contactIds.filter((id) =>
    (ownContacts ?? []).some((c) => c.id === id),
  );
  if (contactIds.length === 0) {
    return { error: "Nenhum dos contatos selecionados é válido." };
  }

  // Consentimento é checado aqui, na hora de montar a campanha — LGPD:
  // envio em massa (categoria marketing) exige consentimento prévio
  // registrado, não basta o contato existir na base.
  const { data: activeConsents } = await supabase
    .from("consents")
    .select("contact_id")
    .eq("org_id", membership.orgId)
    .in("contact_id", contactIds)
    .is("revoked_at", null);

  const consentedIds = new Set((activeConsents ?? []).map((c) => c.contact_id));

  const { data: campaign, error: campaignError } = await supabase
    .from("bulk_campaigns")
    .insert({
      org_id: membership.orgId,
      name: parsed.data.name,
      template_id: parsed.data.templateId,
      created_by: membership.userId,
      status: "sending",
      total_recipients: contactIds.length,
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    console.error("[campaigns] createCampaign falhou:", campaignError?.code, campaignError?.message);
    return { error: "Não foi possível criar a campanha." };
  }

  const recipients = contactIds.map((contactId) => ({
    org_id: membership.orgId,
    campaign_id: campaign.id,
    contact_id: contactId,
    status: consentedIds.has(contactId) ? ("pending" as const) : ("skipped_no_consent" as const),
  }));

  const { error: recipientsError } = await supabase.from("bulk_campaign_recipients").insert(recipients);
  if (recipientsError) {
    console.error("[campaigns] inserir destinatários falhou:", recipientsError.code, recipientsError.message);
    return { error: "Campanha criada, mas não foi possível montar a lista de destinatários." };
  }

  // Um evento por destinatário elegível — o worker que já drena event_log
  // (lib/whatsapp/process-events.ts) processa em lote, sem sobrecarregar a
  // API da Meta de uma vez só.
  const pendingIds = contactIds.filter((id) => consentedIds.has(id));
  if (pendingIds.length > 0) {
    const events = pendingIds.map((contactId) => ({
      org_id: membership.orgId,
      type: "whatsapp_bulk_message",
      payload: { campaign_id: campaign.id, contact_id: contactId },
      dedupe_key: `whatsapp_bulk_message:${campaign.id}:${contactId}`,
    }));
    await supabase.from("event_log").insert(events);
  } else {
    await supabase.from("bulk_campaigns").update({ status: "failed" }).eq("id", campaign.id);
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "campaign.created",
    resourceType: "bulk_campaigns",
    resourceId: campaign.id,
    after: {
      name: parsed.data.name,
      total: contactIds.length,
      elegiveis: pendingIds.length,
      sem_consentimento: contactIds.length - pendingIds.length,
    },
  });

  revalidatePath("/disparos");
  redirect(`/disparos/${campaign.id}`);
}
