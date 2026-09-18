"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";
import { connectChannelSchema } from "@/lib/validation/channels";
import { getPhoneNumberInfo } from "@/lib/whatsapp/graph-client";
import { mapGraphApiError } from "@/lib/whatsapp/errors";
import { encryptToken, bufferToPgBytea } from "@/lib/crypto/token-cipher";

export type ChannelActionState = { error?: string } | null;

export async function connectChannel(
  _prevState: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const parsed = connectChannelSchema.safeParse({
    wabaId: formData.get("wabaId"),
    phoneNumberId: formData.get("phoneNumberId"),
    accessToken: formData.get("accessToken"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  // Confirma que o token/phone_number_id funcionam de verdade antes de
  // salvar — evita guardar credencial quebrada e só descobrir isso quando
  // uma mensagem de cliente chegar.
  let displayPhoneNumber: string | undefined;
  try {
    const info = await getPhoneNumberInfo(parsed.data.phoneNumberId, parsed.data.accessToken);
    displayPhoneNumber = info.display_phone_number;
  } catch (err) {
    return { error: mapGraphApiError(err) };
  }

  const supabase = await createClient();
  const encrypted = bufferToPgBytea(encryptToken(parsed.data.accessToken));

  const { error } = await supabase.from("channels").upsert(
    {
      org_id: membership.orgId,
      waba_id: parsed.data.wabaId,
      phone_number_id: parsed.data.phoneNumberId,
      display_phone_number: displayPhoneNumber,
      access_token_encrypted: encrypted,
      status: "connected",
      last_health_check_at: new Date().toISOString(),
    },
    { onConflict: "phone_number_id" },
  );

  if (error) {
    console.error("[channels] connectChannel falhou:", error.code, error.message);
    return { error: "Não foi possível salvar o canal." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "channel.connected",
    resourceType: "channels",
    after: { phone_number_id: parsed.data.phoneNumberId, display_phone_number: displayPhoneNumber },
  });

  revalidatePath("/configuracoes/whatsapp");
  revalidatePath("/inbox");
  return null;
}

export async function disconnectChannel(
  _prevState: ChannelActionState,
  formData: FormData,
): Promise<ChannelActionState> {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    return { error: err instanceof ForbiddenError ? err.message : "Erro inesperado." };
  }

  const channelId = formData.get("channelId");
  if (typeof channelId !== "string" || !channelId) {
    return { error: "Canal inválido." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("channels")
    .update({ status: "disconnected", access_token_encrypted: null })
    .eq("id", channelId)
    .eq("org_id", membership.orgId);

  if (error) {
    console.error("[channels] disconnectChannel falhou:", error.code, error.message);
    return { error: "Não foi possível desconectar o canal." };
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "channel.disconnected",
    resourceType: "channels",
    resourceId: channelId,
  });

  revalidatePath("/configuracoes/whatsapp");
  revalidatePath("/inbox");
  return null;
}
