import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { createNotification } from "@/lib/notifications/create";
import { logAudit } from "@/lib/audit/log";
import { tryAutoAssignFromRotation } from "@/lib/crm/rotation";

type AdminClient = ReturnType<typeof createAdminClient>;

type ResponseBreachRow = {
  conversation_id: string;
  org_id: string;
  team_id: string | null;
  assigned_to: string;
  assigned_at: string;
  contact_name: string | null;
};

/**
 * Chamado pelo mesmo cron de 1 em 1 minuto que já drena o event_log e roda
 * o alerta de SLA (0018) — diferente daquele, aqui a conversa MUDA de dono
 * de verdade quando o responsável não manda nenhuma mensagem a tempo
 * (primeiro atendimento, não SLA geral). fn_response_breaches só lê
 * candidatos; a reatribuição em si (que reseta assigned_at) é o que evita
 * a mesma conversa estourar nos minutos seguintes — sem precisar de coluna
 * de dedupe como o alerta de SLA precisou.
 */
export async function checkResponseBreaches(supabase: AdminClient): Promise<number> {
  const { data, error } = await supabase.rpc("fn_response_breaches");
  if (error) {
    console.error("[reassignment] fn_response_breaches falhou:", error.code, error.message);
    return 0;
  }

  const breaches = (data ?? []) as ResponseBreachRow[];
  let reassigned = 0;
  for (const breach of breaches) {
    if (await reassignOne(supabase, breach)) reassigned += 1;
  }
  return reassigned;
}

/**
 * Setor da própria conversa, se ele tiver rodízio ligado; senão cai pro
 * setor com rodízio geral da organização (hoje só "Venda Veículos Novos")
 * — mesmo fallback que já existe em processInboundMessage. Cobre o caso de
 * uma conversa herdada da Recepção (sem setor com rodízio próprio).
 */
async function resolveRotationTeamId(
  supabase: AdminClient,
  orgId: string,
  conversationTeamId: string | null,
): Promise<string | null> {
  if (conversationTeamId) {
    // org_id na busca é defesa em profundidade: o client é service role
    // (ignora RLS), então nada além do código garante que o team_id da
    // conversa pertence à mesma organização — hoje sempre pertence (só
    // processInboundMessage grava team_id, já escopado por org), mas não
    // custa não confiar nisso silenciosamente.
    const { data: team } = await supabase
      .from("teams")
      .select("id, auto_distribution")
      .eq("id", conversationTeamId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (team?.auto_distribution) return team.id;
  }

  const { data: autoTeam } = await supabase
    .from("teams")
    .select("id")
    .eq("org_id", orgId)
    .eq("auto_distribution", true)
    .limit(1)
    .maybeSingle();
  return autoTeam?.id ?? null;
}

async function reassignOne(supabase: AdminClient, breach: ResponseBreachRow): Promise<boolean> {
  const teamId = await resolveRotationTeamId(supabase, breach.org_id, breach.team_id);
  // Sem setor de rodízio configurado, não tem fila pra passar adiante —
  // deixa como está (mesma pessoa continua, o alerta de SLA geral cobre daqui pra frente).
  if (!teamId) return false;

  const nextMemberId = await tryAutoAssignFromRotation(supabase, breach.org_id, teamId);

  if (!nextMemberId) {
    // Ninguém online / fora do expediente: solta a conversa (regra 1 — o
    // vendedor anterior perde a atribuição de qualquer forma) em vez de
    // deixar com quem já teve a chance e não respondeu.
    const { data: updated } = await supabase
      .from("conversations")
      .update({ assigned_to: null, assigned_at: null })
      .eq("id", breach.conversation_id)
      .eq("assigned_to", breach.assigned_to)
      .eq("assigned_at", breach.assigned_at)
      .select("id");
    if (updated && updated.length > 0) {
      await logAudit(supabase, {
        orgId: breach.org_id,
        actorId: null,
        action: "conversation.unassigned_no_response",
        resourceType: "conversations",
        resourceId: breach.conversation_id,
        before: { assigned_to: breach.assigned_to },
        after: { assigned_to: null },
      });
      await notifyPreviousOwner(supabase, breach);
    }
    return false;
  }

  // Só essa pessoa disponível no rodízio agora (fn_next_rotation_member
  // devolveu ela de novo) — não é uma reatribuição de fato, não mexe em nada.
  if (nextMemberId === breach.assigned_to) return false;

  const { data: updated } = await supabase
    .from("conversations")
    .update({ assigned_to: nextMemberId, assigned_at: new Date().toISOString() })
    .eq("id", breach.conversation_id)
    .eq("assigned_to", breach.assigned_to)
    .eq("assigned_at", breach.assigned_at)
    .select("id");

  // 0 linhas: outra execução do cron já tinha mexido nessa conversa entre a
  // leitura (fn_response_breaches) e agora — não faz nada de novo.
  if (!updated || updated.length === 0) return false;

  await logAudit(supabase, {
    orgId: breach.org_id,
    actorId: null,
    action: "conversation.reassigned_no_response",
    resourceType: "conversations",
    resourceId: breach.conversation_id,
    before: { assigned_to: breach.assigned_to },
    after: { assigned_to: nextMemberId },
  });

  await notifyPreviousOwner(supabase, breach);
  await createNotification(supabase, {
    orgId: breach.org_id,
    userId: nextMemberId,
    type: "lead.assigned",
    title: "Lead atribuído a você",
    body: breach.contact_name
      ? `${breach.contact_name} · reatribuída por falta de resposta`
      : "Reatribuída por falta de resposta",
    link: `/inbox/${breach.conversation_id}`,
  });

  return true;
}

async function notifyPreviousOwner(supabase: AdminClient, breach: ResponseBreachRow) {
  await createNotification(supabase, {
    orgId: breach.org_id,
    userId: breach.assigned_to,
    type: "conversation.reassigned_away",
    title: "Conversa reatribuída por falta de resposta",
    body: breach.contact_name ?? undefined,
    link: `/inbox/${breach.conversation_id}`,
  });
}
