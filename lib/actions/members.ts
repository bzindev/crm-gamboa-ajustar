"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";

export type MemberActionState = { error?: string; success?: true } | null;

const ERROR_MESSAGES: Record<string, string> = {
  mfa_required: "Confirme o código do 2FA (saia e entre de novo) antes de fazer isso.",
  forbidden: "Você não tem permissão para remover essa pessoa.",
  cannot_remove_self: "Você não pode remover a si mesmo.",
  cannot_remove_owner: "O dono da organização não pode ser removido.",
  not_found: "Essa pessoa não faz mais parte da organização.",
};

export async function removeMember(
  _prevState: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = z.string().uuid().safeParse(formData.get("userId"));
  if (!parsed.success) {
    return { error: "Membro inválido." };
  }

  const supabase = await createClient();
  // As regras (papel de quem remove, não remover a si nem o dono) moram
  // na função do banco — ver migration 0022. Aqui só traduz o resultado.
  const { data: removedRole, error } = await supabase.rpc("fn_remove_org_member", {
    p_org_id: membership.orgId,
    p_user_id: parsed.data,
  });

  if (error) {
    const code = Object.keys(ERROR_MESSAGES).find((key) => error.message.includes(key));
    if (!code) console.error("[members] removeMember falhou:", error.code, error.message);
    return { error: code ? ERROR_MESSAGES[code] : "Não foi possível remover." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "member.removed",
    resourceType: "org_members",
    resourceId: parsed.data,
    before: { user_id: parsed.data, role: removedRole },
  });

  revalidatePath("/configuracoes/equipe");
  return { success: true };
}
