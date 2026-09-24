-- 0019_reatribuicao_automatica.sql
-- Reatribuição automática por falta de primeiro atendimento: diferente do
-- alerta de SLA (0018, que só avisa), aqui a conversa muda de dono de
-- verdade se o vendedor atual não mandar nenhuma mensagem a tempo. Idempotente.

-- Quando a conversa passou a ter ESSE responsável — não confundir com
-- last_inbound_at/last_outbound_at, que só falam da troca de mensagens.
-- Sem valor pra conversa que nunca teve responsável individual (setor
-- Recepção sem ninguém ter assumido ainda) — sem assigned_at, não tem
-- timer, que é exatamente a regra pedida.
alter table public.conversations
  add column if not exists assigned_at timestamptz;

-- Configurável (tela de Configurações), não fixo no código — mesmo padrão
-- de sla_minutes (0018) e stage_alert_days.
alter table public.organizations
  add column if not exists reassign_minutes integer not null default 5;

-- Nenhum backfill de assigned_at pras conversas já atribuídas hoje: sem
-- essa coluna preenchida, fn_response_breaches simplesmente ignora essas
-- linhas (não entram no WHERE) até a próxima atribuição de verdade
-- (rodízio, "assumir conversa" ou responder uma conversa livre) — evita
-- reatribuir em massa tudo que já está em andamento no momento em que essa
-- migration roda.

-- ---------------------------------------------------------------------------
-- fn_response_breaches: só LÊ candidatos a reatribuição — diferente de
-- fn_sla_breaches (0018), que já marca como notificado na mesma operação
-- porque aquilo é só alerta repetível. Aqui, o próprio ato de reatribuir
-- (assigned_to/assigned_at novos) já é o que impede a mesma conversa
-- estourar de novo no minuto seguinte, então não precisa de coluna de
-- dedupe — o worker (lib/whatsapp/reassignment-check.ts) faz o UPDATE com
-- guarda otimista (WHERE assigned_to/assigned_at antigos) pra não reatribuir
-- duas vezes se o cron sobrepuser.
-- ---------------------------------------------------------------------------

create or replace function public.fn_response_breaches()
returns table (
  conversation_id uuid,
  org_id uuid,
  team_id uuid,
  assigned_to uuid,
  assigned_at timestamptz,
  contact_name text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select c.id, c.org_id, c.team_id, c.assigned_to, c.assigned_at, coalesce(ct.name, ct.phone_e164)
  from public.conversations c
  join public.organizations o on o.id = c.org_id
  join public.contacts ct on ct.id = c.contact_id
  where c.status <> 'closed'
    and c.assigned_to is not null
    and c.assigned_at is not null
    and (c.last_outbound_at is null or c.last_outbound_at < c.assigned_at)
    and c.assigned_at < now() - (o.reassign_minutes || ' minutes')::interval;
end;
$$;

-- Só o worker (service role, via cron) chama — mesma justificativa de
-- fn_sla_breaches: é SECURITY DEFINER pra ver todas as organizações de
-- propósito, então não pode ficar exposta como RPC livre pro PostgREST
-- (vazaria nome de contato e quem está atribuído entre organizações).
revoke all on function public.fn_response_breaches() from public, anon, authenticated;
grant execute on function public.fn_response_breaches() to service_role;
