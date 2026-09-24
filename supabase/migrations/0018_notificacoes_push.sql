-- 0018_notificacoes_push.sql
-- Notificação push (Notification API do navegador) para 3 gatilhos: lead
-- atribuído, nova mensagem do cliente, SLA de resposta estourado. A tabela
-- `notifications` já existe (0012) e já é o log de debug pedido — só
-- faltava ela replicar por Realtime (esquecida em 0012, só messages/
-- conversations entraram na publicação). Idempotente.

-- Limite de SLA configurável por organização (tela de Configurações), não
-- fixo no código — mesmo padrão de stage_alert_days.
alter table public.organizations
  add column if not exists sla_minutes integer not null default 15;

-- last_read_at: quando o vendedor responsável abriu a conversa por último —
-- base do contador de não lidas no título da aba. Não é por usuário porque
-- conversa tem um único responsável por vez (assigned_to); se ninguém é
-- responsável, não conta como "não lida" de ninguém.
alter table public.conversations
  add column if not exists last_read_at timestamptz;

-- sla_notified_at: evita notificar de novo a cada minuto enquanto a mesma
-- mensagem seguir sem resposta. Só reabre quando chega uma mensagem NOVA
-- do cliente depois da última notificação (fn_sla_breaches abaixo compara
-- contra last_inbound_at).
alter table public.conversations
  add column if not exists sla_notified_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Setor "Recepção": destino da notificação de lead novo quando não há
-- rodízio (contato cadastrado manualmente, sem setor com distribuição
-- automática) — não tem um vendedor específico pra avisar, avisa o setor.
-- ---------------------------------------------------------------------------

insert into public.teams (org_id, name)
select id, 'Recepção' from public.organizations
on conflict (org_id, name) do nothing;

create or replace function public.fn_create_organization(p_name text)
returns table (org_id uuid, org_slug text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_slug text;
  v_org_id uuid;
  v_pipeline_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then
    v_slug := 'org';
  end if;
  v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);

  insert into public.organizations (name, slug)
  values (trim(p_name), v_slug)
  returning id into v_org_id;

  insert into public.org_members (org_id, user_id, role, accepted_at)
  values (v_org_id, v_uid, 'owner', now());

  insert into public.pipelines (org_id, name, is_default, vocabulary)
  values (
    v_org_id,
    'Vendas',
    true,
    jsonb_build_object(
      'lead_singular', 'Lead',
      'lead_plural', 'Leads',
      'won_label', 'Venda',
      'lost_label', 'Perdido'
    )
  )
  returning id into v_pipeline_id;

  insert into public.pipeline_stages (org_id, pipeline_id, name, position, is_won, is_lost)
  values
    (v_org_id, v_pipeline_id, 'Lead', 1, false, false),
    (v_org_id, v_pipeline_id, 'Em atendimento', 2, false, false),
    (v_org_id, v_pipeline_id, 'Follow-up', 3, false, false),
    (v_org_id, v_pipeline_id, 'Agendado', 4, false, false),
    (v_org_id, v_pipeline_id, 'Compareceu', 5, false, false),
    (v_org_id, v_pipeline_id, 'No-show', 6, false, false),
    (v_org_id, v_pipeline_id, 'Venda', 7, true, false),
    (v_org_id, v_pipeline_id, 'Perdido', 8, false, true);

  insert into public.teams (org_id, name)
  values
    (v_org_id, 'Venda Veículos Novos'),
    (v_org_id, 'Setor de Peças'),
    (v_org_id, 'Setor de Pós-Vendas'),
    (v_org_id, 'Gerência'),
    (v_org_id, 'Recepção');

  return query select v_org_id, v_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- fn_sla_breaches: acha conversas com resposta estourada e já marca como
-- notificada (UPDATE ... RETURNING) na mesma operação — evita duas
-- execuções do cron (ou uma execução lenta sobreposta com a próxima)
-- notificarem a mesma conversa duas vezes. PostgREST não expõe UPDATE...
-- RETURNING de forma atômica assim, por isso é função (mesmo motivo de
-- fn_claim_pending_events em 0006).
-- ---------------------------------------------------------------------------

create or replace function public.fn_sla_breaches()
returns table (
  conversation_id uuid,
  org_id uuid,
  assigned_to uuid,
  contact_name text,
  waited_minutes int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.conversations c
  set sla_notified_at = now()
  from public.contacts ct, public.organizations o
  where c.contact_id = ct.id
    and c.org_id = o.id
    and c.status <> 'closed'
    and c.assigned_to is not null
    and c.last_inbound_at is not null
    and (c.last_outbound_at is null or c.last_outbound_at < c.last_inbound_at)
    and c.last_inbound_at < now() - (o.sla_minutes || ' minutes')::interval
    and (c.sla_notified_at is null or c.sla_notified_at < c.last_inbound_at)
  returning
    c.id,
    c.org_id,
    c.assigned_to,
    coalesce(ct.name, ct.phone_e164),
    floor(extract(epoch from (now() - c.last_inbound_at)) / 60)::int;
end;
$$;

-- Só o worker (service role, via cron) chama isso — mesma justificativa de
-- fn_claim_pending_events e fn_next_rotation_member: SECURITY DEFINER
-- atravessa RLS entre organizações de propósito (o worker precisa ver
-- todas), então não pode ficar exposto como RPC livre pro PostgREST.
revoke all on function public.fn_sla_breaches() from public, anon, authenticated;
grant execute on function public.fn_sla_breaches() to service_role;
