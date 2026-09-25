-- 0020_followup_e_transferencia.sql
-- Follow-up automático (tarefa 26): o indicador visual de "lead parado"
-- já existia (stage_alert_days, migration 0009/0011) — faltava avisar
-- alguém de verdade em vez de só pintar o card no Kanban. Transferência
-- manual de conversa (tarefa 22) não precisa de coluna nova, só de Server
-- Action + UI (ver lib/actions/conversations.ts). Idempotente.

alter table public.leads
  add column if not exists stage_alert_notified_at timestamptz;

-- ---------------------------------------------------------------------------
-- fn_stage_alert_breaches: mesmo padrão de fn_sla_breaches (0018) — marca
-- como notificado na mesma operação (UPDATE ... RETURNING), porque isso
-- aqui também é só alerta (não muda dono do lead, diferente da reatribuição
-- de conversa em 0019). Só notifica lead com responsável individual — sem
-- dono, não tem quem lembrar.
-- ---------------------------------------------------------------------------

create or replace function public.fn_stage_alert_breaches()
returns table (
  lead_id uuid,
  org_id uuid,
  owner_id uuid,
  title text,
  contact_id uuid,
  days_stuck int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.leads l
  set stage_alert_notified_at = now()
  from public.organizations o
  where l.org_id = o.id
    and l.status = 'open'
    and l.owner_id is not null
    and l.stage_entered_at < now() - (o.stage_alert_days || ' days')::interval
    and (l.stage_alert_notified_at is null or l.stage_alert_notified_at < l.stage_entered_at)
  returning l.id, l.org_id, l.owner_id, l.title, l.contact_id,
    floor(extract(epoch from (now() - l.stage_entered_at)) / 86400)::int;
end;
$$;

-- Só o worker (service role, via cron) chama — mesma justificativa das
-- outras funções de checagem (0018/0019): SECURITY DEFINER cruza
-- organizações de propósito, não pode ficar exposta como RPC livre.
revoke all on function public.fn_stage_alert_breaches() from public, anon, authenticated;
grant execute on function public.fn_stage_alert_breaches() to service_role;
