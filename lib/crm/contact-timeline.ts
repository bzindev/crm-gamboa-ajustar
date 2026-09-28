// Sem "server-only": função pura, testada em tests/contact-timeline.test.ts.
// Quem busca os dados é a página do contato; aqui só vira uma lista única.

export type TimelineKind =
  | "contact"
  | "lead"
  | "stage"
  | "conversation"
  | "message_in"
  | "message_out"
  | "consent";

export type TimelineEvent = {
  at: string;
  kind: TimelineKind;
  title: string;
  detail?: string;
  actor?: string;
};

type AuditRow = {
  action: string;
  resource_type: string;
  resource_id: string | null;
  actor_id: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  created_at: string;
};

export type TimelineSources = {
  contact: { name: string | null; created_at: string };
  leads: { id: string; title: string; created_at: string }[];
  messages: { direction: "inbound" | "outbound"; body: string | null; created_at: string; sent_by: string | null }[];
  consents: { created_at: string; revoked_at: string | null; source: string | null }[];
  audit: AuditRow[];
  stageNames: Map<string, string>;
  userNames: Map<string, string>;
};

const MESSAGE_PREVIEW = 140;

const CONVERSATION_STATUS: Record<string, string> = {
  open: "aberta",
  pending: "pendente",
  resolved: "resolvida",
  closed: "fechada",
};

function preview(text: string | null): string | undefined {
  if (!text) return undefined;
  return text.length > MESSAGE_PREVIEW ? `${text.slice(0, MESSAGE_PREVIEW)}…` : text;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function buildContactTimeline(src: TimelineSources, limit = 200): TimelineEvent[] {
  const nameOf = (id: string | null | undefined) => (id ? src.userNames.get(id) ?? "Usuário removido" : undefined);
  const stageOf = (id: unknown) => (typeof id === "string" ? src.stageNames.get(id) ?? "etapa removida" : undefined);
  const leadTitle = new Map(src.leads.map((l) => [l.id, l.title]));
  const events: TimelineEvent[] = [];

  events.push({ at: src.contact.created_at, kind: "contact", title: "Contato cadastrado" });

  for (const lead of src.leads) {
    events.push({ at: lead.created_at, kind: "lead", title: `Lead criado: ${lead.title}` });
  }

  for (const m of src.messages) {
    events.push(
      m.direction === "inbound"
        ? { at: m.created_at, kind: "message_in", title: "Cliente enviou mensagem", detail: preview(m.body) }
        : {
            at: m.created_at,
            kind: "message_out",
            title: m.sent_by ? "Mensagem enviada" : "Mensagem automática enviada",
            detail: preview(m.body),
            actor: nameOf(m.sent_by),
          },
    );
  }

  for (const c of src.consents) {
    events.push({ at: c.created_at, kind: "consent", title: "Aceitou receber mensagens (opt-in)", detail: c.source ?? undefined });
    if (c.revoked_at) events.push({ at: c.revoked_at, kind: "consent", title: "Deixou de aceitar mensagens (opt-out)" });
  }

  for (const a of src.audit) {
    const actor = a.actor_id ? nameOf(a.actor_id) : "Sistema";
    const lead = a.resource_id ? leadTitle.get(a.resource_id) : undefined;
    const after = a.after ?? {};
    const before = a.before ?? {};

    switch (a.action) {
      case "lead.stage_changed":
        events.push({ at: a.created_at, kind: "stage", title: `${lead ?? "Lead"}: ${stageOf(before.stage_id) ?? "—"} → ${stageOf(after.stage_id) ?? "—"}`, actor });
        break;
      case "lead.updated": {
        const status = str(after.status);
        const statusChanged = status && status !== str(before.status);
        const stageChanged = after.stage_id !== before.stage_id;
        if (statusChanged && status === "won") events.push({ at: a.created_at, kind: "stage", title: `${lead ?? "Lead"} marcado como ganho`, actor });
        else if (statusChanged && status === "lost") events.push({ at: a.created_at, kind: "stage", title: `${lead ?? "Lead"} marcado como perdido`, actor });
        else if (stageChanged) events.push({ at: a.created_at, kind: "stage", title: `${lead ?? "Lead"}: ${stageOf(before.stage_id) ?? "—"} → ${stageOf(after.stage_id) ?? "—"}`, actor });
        break;
      }
      case "conversation.claimed":
        events.push({ at: a.created_at, kind: "conversation", title: "Conversa assumida", actor });
        break;
      case "conversation.transferred":
        events.push({ at: a.created_at, kind: "conversation", title: `Conversa transferida para ${nameOf(str(after.assigned_to)) ?? "—"}`, actor });
        break;
      case "conversation.auto_assigned":
        events.push({ at: a.created_at, kind: "conversation", title: `Conversa distribuída pelo rodízio para ${nameOf(str(after.assigned_to)) ?? "—"}` });
        break;
      case "conversation.reassigned_no_response":
        events.push({ at: a.created_at, kind: "conversation", title: `Reatribuída por falta de resposta para ${nameOf(str(after.assigned_to)) ?? "—"}` });
        break;
      case "conversation.unassigned_no_response":
        events.push({ at: a.created_at, kind: "conversation", title: "Conversa ficou sem responsável (ninguém respondeu a tempo)" });
        break;
      case "conversation.status_changed":
        events.push({ at: a.created_at, kind: "conversation", title: `Conversa marcada como ${CONVERSATION_STATUS[str(after.status) ?? ""] ?? "—"}`, actor });
        break;
    }
  }

  return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
