// Sem "server-only": também usado pelo script de restauração (Node puro).

/**
 * Ordem de dependência: quem é referenciado vem antes de quem referencia —
 * a restauração insere nesta ordem, e o backup lê na mesma. `order` é a
 * chave primária, pra paginar de forma estável (sem pular nem repetir
 * linha entre páginas).
 */
export const BACKUP_TABLES: { name: string; order: string[] }[] = [
  { name: "organizations", order: ["id"] },
  { name: "profiles", order: ["id"] },
  { name: "org_members", order: ["id"] },
  { name: "org_invites", order: ["id"] },
  { name: "teams", order: ["id"] },
  { name: "team_members", order: ["team_id", "user_id"] },
  { name: "channels", order: ["id"] },
  { name: "contacts", order: ["id"] },
  { name: "consents", order: ["id"] },
  { name: "pipelines", order: ["id"] },
  { name: "pipeline_stages", order: ["id"] },
  { name: "tags", order: ["id"] },
  { name: "leads", order: ["id"] },
  { name: "lead_tags", order: ["lead_id", "tag_id"] },
  { name: "conversations", order: ["id"] },
  { name: "messages", order: ["id"] },
  { name: "message_templates", order: ["id"] },
  { name: "bulk_campaigns", order: ["id"] },
  { name: "bulk_campaign_recipients", order: ["id"] },
  { name: "notifications", order: ["id"] },
  { name: "quick_replies", order: ["id"] },
  { name: "goals", order: ["id"] },
  { name: "csat_surveys", order: ["id"] },
  { name: "audit_log", order: ["id"] },
  { name: "event_log", order: ["id"] },
  { name: "webhook_deliveries", order: ["id"] },
];

export const BACKUP_BUCKET = "backups";
export const BACKUP_KEEP = 14;
