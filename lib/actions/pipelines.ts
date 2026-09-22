"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { getDefaultPipelineId } from "@/lib/crm/pipeline";
import { logAudit } from "@/lib/audit/log";
import {
  vocabularySchema,
  createStageSchema,
  renameStageSchema,
  deleteStageSchema,
} from "@/lib/validation/pipelines";

export type PipelineActionState = { error?: string } | null;

export async function updateVocabulary(
  _prevState: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = vocabularySchema.safeParse({
    lead_singular: formData.get("lead_singular"),
    lead_plural: formData.get("lead_plural"),
    won_label: formData.get("won_label"),
    lost_label: formData.get("lost_label"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const pipelineId = await getDefaultPipelineId(supabase, membership.orgId);

  const { error } = await supabase
    .from("pipelines")
    .update({ vocabulary: parsed.data })
    .eq("id", pipelineId);

  if (error) {
    console.error("[pipelines] updateVocabulary falhou:", error.code, error.message);
    return { error: "Não foi possível salvar o vocabulário." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "pipeline.vocabulary_updated",
    resourceType: "pipelines",
    resourceId: pipelineId,
    after: parsed.data,
  });

  revalidatePath("/funil");
  return null;
}

export async function createStage(
  _prevState: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = createStageSchema.safeParse({
    pipelineId: formData.get("pipelineId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();

  const { data: stages } = await supabase
    .from("pipeline_stages")
    .select("position")
    .eq("pipeline_id", parsed.data.pipelineId)
    .order("position", { ascending: false })
    .limit(1);

  const nextPosition = (stages?.[0]?.position ?? 0) + 1;

  const { data: stage, error } = await supabase
    .from("pipeline_stages")
    .insert({
      org_id: membership.orgId,
      pipeline_id: parsed.data.pipelineId,
      name: parsed.data.name,
      position: nextPosition,
    })
    .select("id")
    .single();

  if (error || !stage) {
    console.error("[pipelines] createStage falhou:", error?.code, error?.message);
    return { error: "Não foi possível criar a etapa." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "pipeline.stage_created",
    resourceType: "pipeline_stages",
    resourceId: stage.id,
    after: { name: parsed.data.name },
  });

  revalidatePath("/funil");
  return null;
}

export async function renameStage(
  _prevState: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = renameStageSchema.safeParse({
    stageId: formData.get("stageId"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("pipeline_stages")
    .update({ name: parsed.data.name })
    .eq("id", parsed.data.stageId);

  if (error) {
    console.error("[pipelines] renameStage falhou:", error.code, error.message);
    return { error: "Não foi possível renomear a etapa." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "pipeline.stage_renamed",
    resourceType: "pipeline_stages",
    resourceId: parsed.data.stageId,
    after: { name: parsed.data.name },
  });

  revalidatePath("/funil");
  return null;
}

export async function deleteStage(
  _prevState: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = deleteStageSchema.safeParse({ stageId: formData.get("stageId") });
  if (!parsed.success) {
    return { error: "Etapa inválida." };
  }

  const supabase = await createClient();

  const { data: stage } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id, name")
    .eq("id", parsed.data.stageId)
    .single();

  if (!stage) {
    return { error: "Etapa não encontrada." };
  }

  const { data: siblings } = await supabase
    .from("pipeline_stages")
    .select("id")
    .eq("pipeline_id", stage.pipeline_id)
    .order("position", { ascending: true });

  const remaining = siblings?.filter((s) => s.id !== parsed.data.stageId) ?? [];
  if (remaining.length === 0) {
    return { error: "O funil precisa de pelo menos uma etapa." };
  }

  const fallbackStageId = remaining[0].id;

  // Move os leads da etapa apagada para a primeira etapa restante antes de
  // apagar — pipeline_stages.id em leads é "on delete restrict" de
  // propósito: se esse passo falhar, o delete abaixo falha também em vez
  // de apagar a etapa e deixar lead órfão.
  const { error: moveError } = await supabase
    .from("leads")
    .update({ stage_id: fallbackStageId })
    .eq("stage_id", parsed.data.stageId);

  if (moveError) {
    console.error("[pipelines] deleteStage (mover leads) falhou:", moveError.code, moveError.message);
    return { error: "Não foi possível mover os leads desta etapa." };
  }

  const { error: deleteError } = await supabase
    .from("pipeline_stages")
    .delete()
    .eq("id", parsed.data.stageId);

  if (deleteError) {
    console.error("[pipelines] deleteStage falhou:", deleteError.code, deleteError.message);
    return { error: "Não foi possível apagar a etapa." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "pipeline.stage_deleted",
    resourceType: "pipeline_stages",
    resourceId: parsed.data.stageId,
    before: { name: stage.name },
  });

  revalidatePath("/funil");
  return null;
}
