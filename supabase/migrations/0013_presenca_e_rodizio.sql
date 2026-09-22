-- 0013_presenca_e_rodizio.sql
-- Presença de usuário (online/ausente/offline) + rodízio automático de
-- vendedores por setor. Idempotente.

-- --- Presença ---------------------------------------------------------------
-- "Offline" não é um valor que o cliente escreve — é derivado no servidor
-- comparando last_active_at com agora (ver fn_presence_status abaixo). O
-- cliente só reporta 'online' (heartbeat) ou 'away' (10min sem interação).
alter table public.profiles
  add column if not exists presence_status text not null default 'offline'
    check (presence_status in ('online', 'away', 'offline')),
  add column if not exists last_active_at timestamptz;

-- Sem isso, UPDATE em profiles não chega em nenhum client inscrito via
-- supabase-js (mesma necessidade de messages/conversations na migration
-- 0012) — o pontinho de status de colega só atualiza sozinho com isso.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'profiles'
  ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end $$;

-- Único ponto de verdade para "está online agora": se o heartbeat parou de
-- chegar (aba fechada, sem internet), trata como offline mesmo que o valor
-- gravado ainda diga 'online' — evita depender de um cliente avisar que
-- saiu, que nem sempre acontece (fechar aba não dispara handler nenhum).
create or replace function public.fn_presence_status(p_presence_status text, p_last_active_at timestamptz)
returns text
language sql
immutable
as $$
  select case
    when p_last_active_at is null or p_last_active_at < now() - interval '3 minutes' then 'offline'
    else p_presence_status
  end;
$$;

-- --- Rodízio ------------------------------------------------------------
-- Setor decide sozinho se participa de distribuição automática (só "Venda
-- Veículos Novos" começa ligado — ver seed abaixo) e guarda o último
-- vendedor que recebeu algo, pra nunca repetir em sequência.
alter table public.teams
  add column if not exists auto_distribution boolean not null default false,
  add column if not exists last_assigned_member_id uuid references public.profiles(id) on delete set null;

alter table public.conversations
  add column if not exists team_id uuid references public.teams(id) on delete set null;

-- Reivindica o próximo vendedor do rodízio de um setor, pulando quem não
-- está online agora. security definer + "for update" na linha do setor:
-- webhook do WhatsApp e criação de lead podem chamar isso ao mesmo tempo
-- (dois clientes escrevendo "agora" nos seus respectivos setores), e sem
-- lock duas chamadas concorrentes poderiam escolher o mesmo vendedor.
-- Mesmo padrão de concorrência de fn_claim_pending_events (migration 0006).
--
-- É security definer E concedida a "authenticated" (precisa ser chamável
-- pela Server Action de criar lead, que usa o client da própria sessão do
-- usuário) — isso significa que o Supabase expõe ela como RPC direto
-- (supabase.rpc('fn_next_rotation_member', ...)), fora do caminho do
-- Server Action. Sem a checagem abaixo, um usuário autenticado de QUALQUER
-- organização poderia chamar isso com o team_id de outra organização e
-- tanto descobrir quem está online lá quanto corromper o rodízio alheio —
-- security definer ignora a RLS de "teams" por definição, então o limite
-- de organização precisa ser reafirmado aqui dentro. Quando quem chama é o
-- worker (service role, sem JWT de usuário — auth.uid() vem nulo), o
-- acesso já é confiável e a checagem é pulada.
create or replace function public.fn_next_rotation_member(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_last_assigned uuid;
  v_eligible uuid[];
  v_last_position int;
  v_chosen uuid;
begin
  if auth.uid() is not null and not exists (
    select 1 from public.teams t
    where t.id = p_team_id and t.org_id in (select public.fn_user_org_ids())
  ) then
    return null;
  end if;

  select last_assigned_member_id into v_last_assigned
  from public.teams
  where id = p_team_id
  for update;

  if not found then
    return null;
  end if;

  select array_agg(tm.user_id order by tm.created_at asc)
  into v_eligible
  from public.team_members tm
  join public.profiles p on p.id = tm.user_id
  where tm.team_id = p_team_id
    and public.fn_presence_status(p.presence_status, p.last_active_at) = 'online';

  if v_eligible is null or array_length(v_eligible, 1) = 0 then
    return null;
  end if;

  v_last_position := array_position(v_eligible, v_last_assigned);

  if v_last_position is null or v_last_position = array_length(v_eligible, 1) then
    v_chosen := v_eligible[1];
  else
    v_chosen := v_eligible[v_last_position + 1];
  end if;

  update public.teams set last_assigned_member_id = v_chosen where id = p_team_id;

  return v_chosen;
end;
$$;

revoke all on function public.fn_next_rotation_member(uuid) from public, anon;
grant execute on function public.fn_next_rotation_member(uuid) to authenticated, service_role;

-- Só "Venda Veículos Novos" começa com rodízio automático ligado — Peças e
-- Pós-Vendas continuam com atribuição manual até decidirem as regras deles.
update public.teams set auto_distribution = true where name = 'Venda Veículos Novos';

-- fn_create_organization precisa da mesma atualização pra organizações
-- criadas a partir de agora já nascerem com o setor de Vendas em rodízio
-- automático — mesma assinatura/retorno de sempre, create or replace basta.
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

  insert into public.teams (org_id, name, auto_distribution)
  values
    (v_org_id, 'Venda Veículos Novos', true),
    (v_org_id, 'Setor de Peças', false),
    (v_org_id, 'Setor de Pós-Vendas', false),
    (v_org_id, 'Gerência', false);

  return query select v_org_id, v_slug;
end;
$$;
