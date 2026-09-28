import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireRole, ForbiddenError } from "@/lib/auth/require-role";
import { logAudit } from "@/lib/audit/log";

/**
 * Portabilidade (LGPD): tudo que a empresa guarda sobre um contato, num
 * arquivo JSON — pra atender o pedido do titular dos dados. Só admin, e o
 * acesso fica registrado (é leitura de dado pessoal em massa).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  let membership;
  try {
    membership = await requireRole("admin");
  } catch (err) {
    const status = err instanceof ForbiddenError ? 403 : 500;
    return NextResponse.json({ error: "Sem permissão." }, { status });
  }

  const { contactId } = await params;
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, phone_e164, email, opted_in, opted_out_at, anonymized_at, created_at, updated_at")
    .eq("id", contactId)
    .eq("org_id", membership.orgId)
    .maybeSingle();

  if (!contact) {
    return NextResponse.json({ error: "Contato não encontrado." }, { status: 404 });
  }

  const [{ data: leads }, { data: conversations }, { data: consents }] = await Promise.all([
    supabase
      .from("leads")
      .select("title, status, value_cents, vehicle_interest, origin, campaign, lost_reason, created_at, updated_at, pipeline_stages(name)")
      .eq("org_id", membership.orgId)
      .eq("contact_id", contactId),
    supabase.from("conversations").select("id, status, created_at").eq("org_id", membership.orgId).eq("contact_id", contactId),
    supabase.from("consents").select("source, created_at, revoked_at").eq("org_id", membership.orgId).eq("contact_id", contactId),
  ]);

  const conversationIds = (conversations ?? []).map((c) => c.id);
  const { data: messages } = conversationIds.length
    ? await supabase
        .from("messages")
        .select("conversation_id, direction, type, content, status, created_at")
        .eq("org_id", membership.orgId)
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: true })
    : { data: [] };

  await logAudit(supabase, {
    orgId: membership.orgId,
    actorId: membership.userId,
    action: "contact.exported",
    resourceType: "contacts",
    resourceId: contactId,
  });

  const body = {
    gerado_em: new Date().toISOString(),
    organizacao: membership.orgName,
    contato: contact,
    consentimentos: consents ?? [],
    negocios: leads ?? [],
    conversas: (conversations ?? []).map((conversation) => ({
      ...conversation,
      mensagens: (messages ?? []).filter((m) => m.conversation_id === conversation.id),
    })),
  };

  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="dados-contato-${contactId}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
