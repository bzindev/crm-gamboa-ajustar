-- 0031_filtros_inbox.sql
-- Filtros da lista de Conversas feitos no BANCO (antes a lista inteira
-- vinha pro navegador e era filtrada lá). Três partes:
--   1. conversations.resolved_at — data de resolução/fechamento (filtro
--      "resolvida em"), mantida por trigger e preenchida pras antigas a
--      partir do histórico.
--   2. Índices pros filtros mais usados.
--   3. fn_search_conversations — uma chamada devolve a página, o total e a
--      contagem por status já com todos os filtros aplicados.
-- Idempotente.

-- ---------------------------------------------------------------------------
-- 1. resolved_at
-- ---------------------------------------------------------------------------
alter table public.conversations
  add column if not exists resolved_at timestamptz;

-- Trigger (e não a Server Action) porque o status muda por vários caminhos:
-- tela, Kanban, e o worker reabrindo quando o cliente volta a escrever.
-- "Resolvida" e "Fechada" contam as duas como encerradas; passar de uma pra
-- outra mantém a data original. Voltar pra aberta/pendente limpa.
create or replace function public.fn_conversations_resolved_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.status in ('resolved', 'closed') then
    if tg_op = 'INSERT' or old.status not in ('resolved', 'closed') then
      new.resolved_at := coalesce(new.resolved_at, now());
    end if;
  else
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_conversations_resolved_at on public.conversations;
create trigger trg_conversations_resolved_at
  before insert or update of status on public.conversations
  for each row execute function public.fn_conversations_resolved_at();

-- Conversas já encerradas: usa a última troca de status registrada no
-- histórico; sem histórico, a última atualização da linha.
update public.conversations c
set resolved_at = coalesce(
  (
    select max(a.created_at)
    from public.audit_log a
    where a.resource_type = 'conversations'
      and a.resource_id = c.id
      and a.action = 'conversation.status_changed'
      and a.after ->> 'status' in ('resolved', 'closed')
  ),
  c.updated_at
)
where c.status in ('resolved', 'closed')
  and c.resolved_at is null;

-- ---------------------------------------------------------------------------
-- 2. Índices
-- ---------------------------------------------------------------------------
-- "Última atividade" = mensagem mais recente em qualquer direção (greatest
-- ignora nulo); sem nenhuma mensagem, a criação. É a ordem da lista e o
-- campo padrão do filtro de período.
create index if not exists idx_conversations_org_activity
  on public.conversations (org_id, (coalesce(greatest(last_inbound_at, last_outbound_at), created_at)) desc);
create index if not exists idx_conversations_org_assigned
  on public.conversations (org_id, assigned_to);
create index if not exists idx_conversations_org_created
  on public.conversations (org_id, created_at);
create index if not exists idx_conversations_org_resolved
  on public.conversations (org_id, resolved_at)
  where resolved_at is not null;
create index if not exists idx_leads_org_contact
  on public.leads (org_id, contact_id);

-- Busca "contém" por nome/telefone: índice trigram (o btree comum não
-- serve pra '%texto%').
create extension if not exists pg_trgm with schema extensions;

-- O operador fica no schema onde a extensão foi instalada (se ela já
-- existia antes, pode estar em "public" em vez de "extensions").
do $$
declare
  v_schema text;
begin
  select n.nspname into v_schema
  from pg_extension e join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  execute format('create index if not exists idx_contacts_name_trgm on public.contacts using gin (name %I.gin_trgm_ops)', v_schema);
  execute format('create index if not exists idx_contacts_phone_trgm on public.contacts using gin (phone_e164 %I.gin_trgm_ops)', v_schema);
end $$;

-- ---------------------------------------------------------------------------
-- 3. fn_search_conversations
-- ---------------------------------------------------------------------------
-- security INVOKER: roda com a sessão de quem chamou, então a RLS (tenant +
-- 2FA) de cada tabela continua valendo aqui dentro. Parâmetro nulo/vazio =
-- filtro desligado. Entre filtros diferentes vale E; dentro de uma lista,
-- OU — menos etiquetas com p_tag_mode = 'all' (precisa ter todas).
--
-- Vendedor comum (agent) só enxerga as próprias conversas e a fila (sem
-- responsável). A regra está AQUI, não na tela: mesmo que alguém edite a
-- URL pedindo o vendedor X, o E com esta condição devolve vazio.
create or replace function public.fn_search_conversations(
  p_org_id uuid,
  p_status text default null,
  p_temperatures text[] default null,
  p_include_no_temperature boolean default false,
  p_tag_ids uuid[] default null,
  p_tag_mode text default 'any',
  p_assignees uuid[] default null,
  p_include_unassigned boolean default false,
  p_team_ids uuid[] default null,
  p_stage_ids uuid[] default null,
  p_date_field text default 'activity',
  p_date_from timestamptz default null,
  p_date_to timestamptz default null,
  p_unread boolean default false,
  p_awaiting boolean default false,
  p_search text default null,
  p_search_digits text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_role text;
  v_pattern text;
  v_result jsonb;
begin
  select m.role into v_role
  from org_members m
  where m.org_id = p_org_id
    and m.user_id = auth.uid()
    and m.accepted_at is not null;

  if v_role is null then
    return jsonb_build_object('total', 0, 'by_status', '{}'::jsonb, 'items', '[]'::jsonb);
  end if;

  -- Escapa % e _ digitados pela pessoa pra valerem como texto, não curinga.
  if nullif(trim(p_search), '') is not null then
    v_pattern := '%' || replace(replace(replace(trim(p_search), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with base as (
    select
      c.id,
      c.status,
      c.temperature,
      c.assigned_to,
      c.contact_id,
      c.created_at,
      coalesce(greatest(c.last_inbound_at, c.last_outbound_at), c.created_at) as activity_at,
      ct.name as contact_name,
      ct.phone_e164
    from conversations c
    join contacts ct on ct.id = c.contact_id
    where c.org_id = p_org_id
      and (v_role <> 'agent' or c.assigned_to = auth.uid() or c.assigned_to is null)
      -- temperatura
      and (
        (p_temperatures is null and not p_include_no_temperature)
        or c.temperature = any (p_temperatures)
        or (p_include_no_temperature and c.temperature is null)
      )
      -- vendedor
      and (
        (p_assignees is null and not p_include_unassigned)
        or c.assigned_to = any (p_assignees)
        or (p_include_unassigned and c.assigned_to is null)
      )
      -- etiquetas
      and (
        p_tag_ids is null
        or (
          p_tag_mode = 'all'
          and (
            select count(distinct x.tag_id)
            from conversation_tags x
            where x.conversation_id = c.id and x.tag_id = any (p_tag_ids)
          ) = cardinality(p_tag_ids)
        )
        or (
          p_tag_mode <> 'all'
          and exists (
            select 1 from conversation_tags x
            where x.conversation_id = c.id and x.tag_id = any (p_tag_ids)
          )
        )
      )
      -- setor
      and (p_team_ids is null or c.team_id = any (p_team_ids))
      -- etapa do funil: pelo contato (lead e conversa apontam pro mesmo)
      and (
        p_stage_ids is null
        or exists (
          select 1 from leads l
          where l.org_id = c.org_id and l.contact_id = c.contact_id and l.stage_id = any (p_stage_ids)
        )
      )
      -- período: início incluso, fim excluso
      and (
        (p_date_from is null and p_date_to is null)
        or (
          case p_date_field
            when 'created' then c.created_at
            when 'resolved' then c.resolved_at
            else coalesce(greatest(c.last_inbound_at, c.last_outbound_at), c.created_at)
          end >= coalesce(p_date_from, '-infinity'::timestamptz)
          and case p_date_field
            when 'created' then c.created_at
            when 'resolved' then c.resolved_at
            else coalesce(greatest(c.last_inbound_at, c.last_outbound_at), c.created_at)
          end < coalesce(p_date_to, 'infinity'::timestamptz)
        )
      )
      -- não lidas: cliente escreveu depois da última vez que o responsável abriu
      and (
        not p_unread
        or (c.last_inbound_at is not null and (c.last_read_at is null or c.last_read_at < c.last_inbound_at))
      )
      -- aguardando resposta: a última mensagem é do cliente
      and (
        not p_awaiting
        or (c.last_inbound_at is not null and (c.last_outbound_at is null or c.last_outbound_at < c.last_inbound_at))
      )
      -- busca: nome ou telefone do contato
      and (
        v_pattern is null
        or ct.name ilike v_pattern
        or (nullif(p_search_digits, '') is not null and ct.phone_e164 like '%' || p_search_digits || '%')
      )
  ),
  filtered as (
    select * from base where p_status is null or status = p_status
  ),
  page as (
    select * from filtered
    order by activity_at desc, id
    limit least(greatest(p_limit, 1), 200)
    offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    -- Contagem das abas: todos os OUTROS filtros aplicados, menos o de status.
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (select status, count(*) as n from base group by status) s), '{}'::jsonb),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'status', p.status,
          'temperature', p.temperature,
          'assigned_to', p.assigned_to,
          'assigned_name', pr.full_name,
          'contact_name', p.contact_name,
          'contact_phone', p.phone_e164,
          'activity_at', p.activity_at,
          'last_message', case when lm.type is null then null else jsonb_build_object('type', lm.type, 'content', lm.content) end,
          'tags', coalesce((
            select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'color', t.color) order by t.name)
            from conversation_tags x join tags t on t.id = x.tag_id
            where x.conversation_id = p.id
          ), '[]'::jsonb)
        )
        order by p.activity_at desc, p.id
      )
      from page p
      left join profiles pr on pr.id = p.assigned_to
      left join lateral (
        select m.type, m.content
        from messages m
        where m.conversation_id = p.id
        order by m.created_at desc
        limit 1
      ) lm on true
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke all on function public.fn_search_conversations(uuid, text, text[], boolean, uuid[], text, uuid[], boolean, uuid[], uuid[], text, timestamptz, timestamptz, boolean, boolean, text, text, integer, integer) from public, anon;
grant execute on function public.fn_search_conversations(uuid, text, text[], boolean, uuid[], text, uuid[], boolean, uuid[], uuid[], text, timestamptz, timestamptz, boolean, boolean, text, text, integer, integer) to authenticated, service_role;
