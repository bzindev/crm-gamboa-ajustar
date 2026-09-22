"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { getDefaultPipelineId } from "@/lib/crm/pipeline";
import { calculateNewPosition } from "@/lib/crm/position";
import { logAudit } from "@/lib/audit/log";
import { createNotification } from "@/lib/notifications/create";
import { tryAutoAssignFromRotation } from "@/lib/crm/rotation";
import {
  createLeadSchema,
  updateLeadSchema,
  moveLeadSchema,
} from "@/lib/validation/leads";

export type LeadActionState = { error?: string; success?: true } | null;

async function nextPositionInStage(
  supabase: Awaited<ReturnType<typeof createClient>>,
  stageId: string,
): Promise<number> {
  const { data } = await supabase
    .from("leads")
    .select("position")
    .eq("stage_id", stageId)
    .order("position", { ascending: false })
    .limit(1);

  return calculateNewPosition(data?.[0]?.position ?? null, null);
}

export async function createLead(
  _prevState: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const membership = await getActiveOrgMembership();
  if (!membership) {
    return { error: "Você precisa fazer parte de uma organização." };
  }

  const parsed = createLeadSchema.safeParse({
    title: formData.get("title"),
    stageId: formData.get("stageId"),
    valueReais: formData.get("valueReais") || undefined,
    ownerId: formData.get("ownerId") || undefined,
    contactId: formData.get("contactId") || undefined,
    newContactName: formData.get("newContactName") || undefined,
    newContactPhone: formData.get("newContactPhone") || undefined,
    tagIds: formData.getAll("tagIds"),
    vehicleInterest: formData.get("vehicleInterest") || undefined,
    temperature: formData.get("temperature") || undefined,
    origin: formData.get("origin") || undefined,
    campaign: formData.get("campaign") || undefined,
    teamId: formData.get("teamId") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  let contactId = parsed.data.contactId || undefined;

  if (!contactId) {
    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .insert({
        org_id: membership.orgId,
        name: parsed.data.newContactName!,
        phone_e164: parsed.data.newContactPhone!,
      })
      .select("id")
      .single();

    if (contactError) {
      if (contactError.code === "23505") {
        return { error: "Já existe um contato com esse telefone. Escolha-o na lista." };
      }
      console.error("[leads] criar contato inline falhou:", contactError.code, contactError.message);
      return { error: "Não foi possível criar o contato." };
    }
    contactId = contact.id;
  }

  const pipelineId = await getDefaultPipelineId(supabase, membership.orgId);
  const position = await nextPositionInStage(supabase, parsed.data.stageId);

  // Sem responsável escolhido à mão: se o setor participa do rodízio,
  // distribui automaticamente em vez de deixar o lead sem dono.
  let ownerId = parsed.data.ownerId || null;
  if (!ownerId && parsed.data.teamId) {
    ownerId = await tryAutoAssignFromRotation(supabase, parsed.data.teamId);
  }

  const { data: lead, error } = await supabase
    .from("leads")
    .insert({
      org_id: membership.orgId,
      pipeline_id: pipelineId,
      stage_id: parsed.data.stageId,
      contact_id: contactId,
      title: parsed.data.title,
      value_cents:
        parsed.data.valueReais !== undefined ? Math.round(parsed.data.valueReais * 100) : null,
      owner_id: ownerId,
      position,
      vehicle_interest: parsed.data.vehicleInterest || null,
      temperature: parsed.data.temperature ?? "cold",
      origin: parsed.data.origin || null,
      campaign: parsed.data.campaign || null,
      team_id: parsed.data.teamId || null,
    })
    .select("id")
    .single();

  if (error || !lead) {
    console.error("[leads] createLead falhou:", error?.code, error?.message);
    return { error: "Não foi possível criar o lead." };
  }

  if (parsed.data.tagIds && parsed.data.tagIds.length > 0) {
    await supabase.from("lead_tags").insert(
      parsed.data.tagIds.map((tagId) => ({
        org_id: membership.orgId,
        lead_id: lead.id,
        tag_id: tagId,
      })),
    );
  }

  const autoAssigned = ownerId !== null && !parsed.data.ownerId;
  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "lead.created",
    resourceType: "leads",
    resourceId: lead.id,
    after: { title: parsed.data.title, stage_id: parsed.data.stageId, owner_id: ownerId, auto_assigned: autoAssigned },
  });

  // Notifica quem foi atribuído (à mão ou pelo rodízio) — exceto quando a
  // pessoa se atribui o próprio lead, aí não tem por que avisar quem já sabe.
  if (ownerId && ownerId !== membership.userId) {
    await createNotification(supabase, {
      orgId: membership.orgId,
      userId: ownerId,
      type: "lead.assigned",
      title: "Lead atribuído a você",
      body: parsed.data.title,
      link: "/funil",
    });
  }

  revalidatePath("/funil");
  return { success: true };
}

export async function updateLead(
  _prevState: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const membership = await getActiveOrgMembership();
  if (!membership) {
    return { error: "Você precisa fazer parte de uma organização." };
  }

  const parsed = updateLeadSchema.safeParse({
    id: formData.get("id"),
    title: formData.get("title"),
    stageId: formData.get("stageId"),
    valueReais: formData.get("valueReais") || undefined,
    ownerId: formData.get("ownerId") || undefined,
    tagIds: formData.getAll("tagIds"),
    status: formData.get("status") || undefined,
    lostReason: formData.get("lostReason") || undefined,
    vehicleInterest: formData.get("vehicleInterest") || undefined,
    temperature: formData.get("temperature") || undefined,
    origin: formData.get("origin") || undefined,
    campaign: formData.get("campaign") || undefined,
    teamId: formData.get("teamId") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("leads")
    .select("stage_id, position, status, title, owner_id")
    .eq("id", parsed.data.id)
    .single();

  if (!current) {
    return { error: "Lead não encontrado." };
  }

  const stageChanged = current.stage_id !== parsed.data.stageId;
  const position = stageChanged
    ? await nextPositionInStage(supabase, parsed.data.stageId)
    : current.position;

  const { error } = await supabase
    .from("leads")
    .update({
      title: parsed.data.title,
      stage_id: parsed.data.stageId,
      position,
      value_cents:
        parsed.data.valueReais !== undefined ? Math.round(parsed.data.valueReais * 100) : null,
      owner_id: parsed.data.ownerId || null,
      status: parsed.data.status ?? "open",
      lost_reason: parsed.data.status === "lost" ? parsed.data.lostReason ?? null : null,
      vehicle_interest: parsed.data.vehicleInterest || null,
      temperature: parsed.data.temperature ?? "cold",
      origin: parsed.data.origin || null,
      campaign: parsed.data.campaign || null,
      team_id: parsed.data.teamId || null,
    })
    .eq("id", parsed.data.id);

  if (error) {
    console.error("[leads] updateLead falhou:", error.code, error.message);
    return { error: "Não foi possível atualizar o lead." };
  }

  // Substitui o conjunto de tags por completo — lista pequena, não compensa
  // calcular diff.
  await supabase.from("lead_tags").delete().eq("lead_id", parsed.data.id);
  if (parsed.data.tagIds && parsed.data.tagIds.length > 0) {
    await supabase.from("lead_tags").insert(
      parsed.data.tagIds.map((tagId) => ({
        org_id: membership.orgId,
        lead_id: parsed.data.id,
        tag_id: tagId,
      })),
    );
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "lead.updated",
    resourceType: "leads",
    resourceId: parsed.data.id,
    before: { stage_id: current.stage_id, status: current.status },
    after: { stage_id: parsed.data.stageId, status: parsed.data.status ?? "open" },
  });

  const newOwnerId = parsed.data.ownerId || null;
  if (newOwnerId && newOwnerId !== current.owner_id && newOwnerId !== membership.userId) {
    await createNotification(supabase, {
      orgId: membership.orgId,
      userId: newOwnerId,
      type: "lead.assigned",
      title: "Lead atribuído a você",
      body: parsed.data.title,
      link: "/funil",
    });
  }

  revalidatePath("/funil");
  return { success: true };
}

/** Chamada pelo drag-and-drop do kanban — sem redirecionar, só confirma sucesso. */
export async function moveLead(input: unknown): Promise<{ error?: string }> {
  const membership = await getActiveOrgMembership();
  if (!membership) {
    return { error: "Você precisa fazer parte de uma organização." };
  }

  const parsed = moveLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "Movimento inválido." };
  }

  const supabase = await createClient();

  const { data: current } = await supabase
    .from("leads")
    .select("stage_id")
    .eq("id", parsed.data.leadId)
    .single();

  const { error } = await supabase
    .from("leads")
    .update({ stage_id: parsed.data.stageId, position: parsed.data.position })
    .eq("id", parsed.data.leadId);

  if (error) {
    console.error("[leads] moveLead falhou:", error.code, error.message);
    return { error: "Não foi possível mover o lead." };
  }

  if (current && current.stage_id !== parsed.data.stageId) {
    await logAudit(supabase, {
      orgId: membership.orgId,
      actorId: membership.userId,
      action: "lead.stage_changed",
      resourceType: "leads",
      resourceId: parsed.data.leadId,
      before: { stage_id: current.stage_id },
      after: { stage_id: parsed.data.stageId },
    });
  }

  revalidatePath("/funil");
  return {};
}
