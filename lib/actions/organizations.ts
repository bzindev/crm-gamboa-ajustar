"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { setActiveOrgCookie } from "@/lib/auth/active-org-cookie";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
  updateStageAlertDaysSchema,
  updateBusinessHoursSchema,
  updateSlaMinutesSchema,
  updateReassignMinutesSchema,
} from "@/lib/validation/organizations";

export type ActionState = { error?: string } | null;

export async function createOrganization(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();

  // fn_create_organization roda como security definer: cria a organização
  // e já insere o usuário atual como owner na mesma transação. Ver
  // supabase/migrations/0003_fn_organizacoes_e_convites.sql para o porquê
  // de isso não dar para fazer com dois INSERTs comuns sob RLS.
  const { data, error } = await supabase
    .rpc("fn_create_organization", { p_name: parsed.data.name })
    .single()
    .returns<{ org_id: string; org_slug: string }>();

  if (error || !data) {
    return { error: "Não foi possível criar a organização. Tente novamente." };
  }

  await setActiveOrgCookie(data.org_id);
  redirect("/dashboard");
}

export async function updateOrganization(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = updateOrganizationSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ name: parsed.data.name })
    .eq("id", membership.orgId);

  if (error) {
    console.error("[organizations] updateOrganization falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "organization.updated",
    resourceType: "organizations",
    resourceId: membership.orgId,
    after: { name: parsed.data.name },
  });

  revalidatePath("/configuracoes/geral");
  return null;
}

export async function updateStageAlertDays(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = updateStageAlertDaysSchema.safeParse({
    stageAlertDays: formData.get("stageAlertDays"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ stage_alert_days: parsed.data.stageAlertDays })
    .eq("id", membership.orgId);

  if (error) {
    console.error("[organizations] updateStageAlertDays falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "organization.stage_alert_days_updated",
    resourceType: "organizations",
    resourceId: membership.orgId,
    after: { stage_alert_days: parsed.data.stageAlertDays },
  });

  revalidatePath("/automacoes");
  revalidatePath("/dashboard");
  revalidatePath("/funil");
  return null;
}

export async function updateBusinessHours(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = updateBusinessHoursSchema.safeParse({
    weekday_open: formData.get("weekday_open"),
    weekday_close: formData.get("weekday_close"),
    saturday_enabled: formData.get("saturday_enabled") === "on",
    saturday_open: formData.get("saturday_open"),
    saturday_close: formData.get("saturday_close"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ business_hours: parsed.data })
    .eq("id", membership.orgId);

  if (error) {
    console.error("[organizations] updateBusinessHours falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "organization.business_hours_updated",
    resourceType: "organizations",
    resourceId: membership.orgId,
    after: parsed.data,
  });

  revalidatePath("/configuracoes/geral");
  return null;
}

export async function updateSlaMinutes(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = updateSlaMinutesSchema.safeParse({
    slaMinutes: formData.get("slaMinutes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ sla_minutes: parsed.data.slaMinutes })
    .eq("id", membership.orgId);

  if (error) {
    console.error("[organizations] updateSlaMinutes falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "organization.sla_minutes_updated",
    resourceType: "organizations",
    resourceId: membership.orgId,
    after: { sla_minutes: parsed.data.slaMinutes },
  });

  revalidatePath("/configuracoes/sla-rodizio");
  return null;
}

export async function updateReassignMinutes(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = updateReassignMinutesSchema.safeParse({
    reassignMinutes: formData.get("reassignMinutes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({ reassign_minutes: parsed.data.reassignMinutes })
    .eq("id", membership.orgId);

  if (error) {
    console.error("[organizations] updateReassignMinutes falhou:", error.code, error.message);
    return { error: "Não foi possível salvar." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "organization.reassign_minutes_updated",
    resourceType: "organizations",
    resourceId: membership.orgId,
    after: { reassign_minutes: parsed.data.reassignMinutes },
  });

  revalidatePath("/configuracoes/sla-rodizio");
  return null;
}
