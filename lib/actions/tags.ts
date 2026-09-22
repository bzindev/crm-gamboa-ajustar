"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/log";
import { createTagSchema } from "@/lib/validation/tags";

export type TagActionState = { error?: string } | null;

export async function createTag(
  _prevState: TagActionState,
  formData: FormData,
): Promise<TagActionState> {
  const membership = await getActiveOrgMembership();
  if (!membership) {
    return { error: "Você precisa fazer parte de uma organização." };
  }

  const parsed = createTagSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") || undefined,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: tag, error } = await supabase
    .from("tags")
    .insert({
      org_id: membership.orgId,
      name: parsed.data.name,
      color: parsed.data.color,
    })
    .select("id")
    .single();

  if (error || !tag) {
    if (error?.code === "23505") {
      return { error: "Já existe uma tag com esse nome." };
    }
    console.error("[tags] createTag falhou:", error?.code, error?.message);
    return { error: "Não foi possível criar a tag." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "tag.created",
    resourceType: "tags",
    resourceId: tag.id,
    after: { name: parsed.data.name, color: parsed.data.color },
  });

  revalidatePath("/funil");
  return null;
}

export async function deleteTag(tagId: string) {
  const membership = await getActiveOrgMembership();
  if (!membership) return;

  const supabase = await createClient();
  await supabase.from("tags").delete().eq("id", tagId);

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "tag.deleted",
    resourceType: "tags",
    resourceId: tagId,
  });

  revalidatePath("/funil");
}
