"use server";

import crypto from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { setActiveOrgCookie } from "@/lib/auth/active-org-cookie";
import { getUser } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/log";
import {
  createInviteSchema,
  acceptInviteSchema,
} from "@/lib/validation/invites";

export type CreateInviteState = { error?: string; inviteUrl?: string } | null;
export type AcceptInviteState = { error?: string } | null;

export async function createInvite(
  _prevState: CreateInviteState,
  formData: FormData,
): Promise<CreateInviteState> {
  let membership;
  try {
    // Só admin/owner convida — checado no servidor, não só escondendo o
    // formulário na tela para outros papéis.
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = createInviteSchema.safeParse({
    email: formData.get("email"),
    role: formData.get("role"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const token = crypto.randomBytes(24).toString("hex");
  const supabase = await createClient();

  const { data: invite, error } = await supabase
    .from("org_invites")
    .insert({
      org_id: membership.orgId,
      email: parsed.data.email.toLowerCase(),
      role: parsed.data.role,
      token,
      invited_by: membership.userId,
    })
    .select("id")
    .single();

  if (error || !invite) {
    console.error("[invites] createInvite falhou:", error?.code, error?.message);
    return { error: "Não foi possível criar o convite." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "invite.created",
    resourceType: "org_invites",
    resourceId: invite.id,
    after: { email: parsed.data.email.toLowerCase(), role: parsed.data.role },
  });

  revalidatePath("/configuracoes/equipe");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return { inviteUrl: `${baseUrl}/convite/${token}` };
}

function mapAcceptInviteError(rawMessage: string): string {
  if (rawMessage.includes("convite_invalido")) {
    return "Este link de convite não é válido.";
  }
  if (rawMessage.includes("convite_ja_usado")) {
    return "Este convite já foi utilizado.";
  }
  if (rawMessage.includes("convite_expirado")) {
    return "Este convite expirou. Peça um novo link a quem te convidou.";
  }
  if (rawMessage.includes("email_nao_corresponde")) {
    return "Entre com a conta que recebeu este convite (o e-mail não corresponde).";
  }
  if (rawMessage.includes("not_authenticated")) {
    return "Faça login ou crie uma conta para aceitar o convite.";
  }
  return "Não foi possível aceitar o convite.";
}

export async function acceptInvite(
  _prevState: AcceptInviteState,
  formData: FormData,
): Promise<AcceptInviteState> {
  const parsed = acceptInviteSchema.safeParse({ token: formData.get("token") });
  if (!parsed.success) {
    return { error: "Convite inválido." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("fn_accept_invite", { p_token: parsed.data.token })
    .single()
    .returns<{ result_org_id: string; result_org_name: string }>();

  if (error || !data) {
    console.error("[invites] acceptInvite falhou:", error?.code, error?.message);
    return { error: mapAcceptInviteError(error?.message ?? "") };
  }

  const user = await getUser();
  if (user) {
    await logAudit(supabase, {
      orgId: data.result_org_id,
      actorId: user.id,
      action: "invite.accepted",
      resourceType: "org_invites",
    });
  }

  await setActiveOrgCookie(data.result_org_id);
  redirect("/dashboard");
}
