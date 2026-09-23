"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { logAudit } from "@/lib/audit/log";
import { contactSchema } from "@/lib/validation/contacts";
import { syncConsent } from "@/lib/crm/consent";

export type ContactActionState = { error?: string; success?: true } | null;

function mapContactDuplicateError(message: string | undefined): string {
  if (message?.includes("uq_contacts_org_email")) {
    return "Já existe um contato com esse e-mail.";
  }
  return "Já existe um contato com esse telefone.";
}

export async function createContact(
  _prevState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const membership = await getActiveOrgMembership();
  if (!membership) {
    return { error: "Você precisa fazer parte de uma organização." };
  }

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    phone_e164: formData.get("phone_e164"),
    email: formData.get("email") || undefined,
    optedIn: formData.get("optedIn") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data: contact, error } = await supabase
    .from("contacts")
    .insert({
      org_id: membership.orgId,
      name: parsed.data.name,
      phone_e164: parsed.data.phone_e164,
      email: parsed.data.email || null,
    })
    .select("id")
    .single();

  if (error || !contact) {
    if (error?.code === "23505") {
      return { error: mapContactDuplicateError(error.message) };
    }
    console.error("[contacts] createContact falhou:", error?.code, error?.message);
    return { error: "Não foi possível criar o contato." };
  }

  if (parsed.data.optedIn) {
    await syncConsent(supabase, { orgId: membership.orgId, contactId: contact.id, optedIn: true });
  }

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "contact.created",
    resourceType: "contacts",
    resourceId: contact.id,
    after: { name: parsed.data.name, phone_e164: parsed.data.phone_e164 },
  });

  revalidatePath("/contatos");
  return { success: true };
}

export async function updateContact(
  _prevState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const membership = await getActiveOrgMembership();
  if (!membership) {
    return { error: "Você precisa fazer parte de uma organização." };
  }

  const id = formData.get("id");
  if (typeof id !== "string") {
    return { error: "Contato inválido." };
  }

  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    phone_e164: formData.get("phone_e164"),
    email: formData.get("email") || undefined,
    optedIn: formData.get("optedIn") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  // Filtra por org_id e confirma que uma linha voltou — sem isso, um id de
  // contato de outra organização passava batido (RLS só faz o update virar
  // no-op silencioso, sem erro), e o syncConsent logo abaixo gravaria
  // consentimento pra um contato que não é desta organização.
  const { data: updated, error } = await supabase
    .from("contacts")
    .update({
      name: parsed.data.name,
      phone_e164: parsed.data.phone_e164,
      email: parsed.data.email || null,
    })
    .eq("id", id)
    .eq("org_id", membership.orgId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505") {
      return { error: mapContactDuplicateError(error.message) };
    }
    console.error("[contacts] updateContact falhou:", error.code, error.message);
    return { error: "Não foi possível atualizar o contato." };
  }
  if (!updated) {
    return { error: "Contato não encontrado." };
  }

  await syncConsent(supabase, { orgId: membership.orgId, contactId: id, optedIn: Boolean(parsed.data.optedIn) });

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "contact.updated",
    resourceType: "contacts",
    resourceId: id,
    after: { name: parsed.data.name, phone_e164: parsed.data.phone_e164 },
  });

  revalidatePath("/contatos");
  return { success: true };
}
