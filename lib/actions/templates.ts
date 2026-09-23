"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { createTemplateSchema } from "@/lib/validation/templates";
import { createMessageTemplate, getMessageTemplateStatus } from "@/lib/whatsapp/graph-client";
import { mapGraphApiError } from "@/lib/whatsapp/errors";
import { decryptToken, pgByteaToBuffer } from "@/lib/crypto/token-cipher";

export type TemplateActionState = { error?: string } | null;

async function getConnectedChannel(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string) {
  const { data: channel } = await supabase
    .from("channels")
    .select("waba_id, access_token_encrypted, status")
    .eq("org_id", orgId)
    .eq("status", "connected")
    .maybeSingle();

  if (!channel || !channel.access_token_encrypted) return null;
  return {
    wabaId: channel.waba_id,
    accessToken: decryptToken(pgByteaToBuffer(channel.access_token_encrypted)),
  };
}

// Templates de marketing (categoria "MARKETING") entram na conversa fora
// da janela de 24h por definição — a Meta exige consentimento prévio do
// destinatário pra esse tipo de mensagem, por isso a checagem de consents
// é obrigatória lá na hora de montar a campanha (lib/actions/campaigns.ts),
// não aqui na criação do template em si.
export async function createTemplate(
  _prevState: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  let membership;
  try {
    // Admin, porque isso é uma submissão pra aprovação da Meta vinculada
    // ao WABA da organização — mesma sensibilidade de conectar o canal.
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = createTemplateSchema.safeParse({
    name: formData.get("name"),
    language: formData.get("language"),
    category: formData.get("category"),
    bodyText: formData.get("bodyText"),
    hasVariable: formData.get("hasVariable") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const channel = await getConnectedChannel(supabase, membership.orgId);
  if (!channel) {
    return { error: "Conecte o canal do WhatsApp antes de criar um template." };
  }

  let metaTemplateId: string | undefined;
  let metaStatus = "pending";
  try {
    const result = await createMessageTemplate(channel.wabaId, channel.accessToken, {
      name: parsed.data.name,
      language: parsed.data.language,
      category: parsed.data.category,
      bodyText: parsed.data.bodyText,
    });
    metaTemplateId = result.id;
    metaStatus = result.status?.toLowerCase() ?? "pending";
  } catch (err) {
    return { error: mapGraphApiError(err) };
  }

  const { data: template, error } = await supabase
    .from("message_templates")
    .insert({
      org_id: membership.orgId,
      name: parsed.data.name,
      language: parsed.data.language,
      category: parsed.data.category,
      body_text: parsed.data.bodyText,
      variable_count: parsed.data.hasVariable ? 1 : 0,
      meta_template_id: metaTemplateId,
      status: metaStatus === "approved" ? "approved" : metaStatus === "rejected" ? "rejected" : "pending",
      created_by: membership.userId,
    })
    .select("id")
    .single();

  if (error || !template) {
    if (error?.code === "23505") {
      return { error: "Já existe um template com esse nome e idioma." };
    }
    console.error("[templates] createTemplate falhou:", error?.code, error?.message);
    return { error: "Template enviado à Meta, mas não foi possível salvar aqui. Anote o nome e avise o suporte." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "template.created",
    resourceType: "message_templates",
    resourceId: template.id,
    after: { name: parsed.data.name, category: parsed.data.category, status: metaStatus },
  });

  revalidatePath("/disparos/templates");
  return null;
}

// A aprovação acontece do lado da Meta, fora do nosso controle (de minutos
// a dias) — este botão só consulta o status atual, não força nada.
export async function refreshTemplateStatus(templateId: string): Promise<TemplateActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const supabase = await createClient();

  const { data: template } = await supabase
    .from("message_templates")
    .select("name")
    .eq("id", templateId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!template) return { error: "Template não encontrado." };

  const channel = await getConnectedChannel(supabase, membership.orgId);
  if (!channel) return { error: "Canal do WhatsApp não está conectado." };

  let remote;
  try {
    remote = await getMessageTemplateStatus(channel.wabaId, channel.accessToken, template.name);
  } catch (err) {
    return { error: mapGraphApiError(err) };
  }

  if (!remote) return { error: "A Meta não retornou esse template." };

  const status = remote.status.toLowerCase();
  await supabase
    .from("message_templates")
    .update({
      status: status === "approved" ? "approved" : status === "rejected" ? "rejected" : "pending",
      rejected_reason: remote.rejected_reason ?? null,
    })
    .eq("id", templateId);

  revalidatePath("/disparos/templates");
  return null;
}
