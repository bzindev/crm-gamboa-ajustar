-- 0010_setores.sql
-- Setores/departamentos da concessionária (Venda Veículos Novos, Peças,
-- Pós-Vendas, Gerência) — hoje só organizam quem faz parte de qual área e
-- podem ser atribuídos a um lead (além do responsável individual, que
-- continua existindo). O roteamento automático por intenção do cliente no
-- WhatsApp fica para quando o canal estiver conectado (Fase 2, pausada) +
-- automações — esta migration só cria a estrutura de dados.
-- Idempotente.

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists public.team_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

alter table public.leads
  add column if not exists team_id uuid references public.teams(id) on delete set null;

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

drop policy if exists tenant_isolation_teams on public.teams;
create policy tenant_isolation_teams on public.teams
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_team_members on public.team_members;
create policy tenant_isolation_team_members on public.team_members
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

-- ---------------------------------------------------------------------------
-- Backfill: organizações que já existem ganham os 4 setores padrão de
-- concessionária. Idempotente (só cria os que faltam, por nome).
-- ---------------------------------------------------------------------------

do $$
declare
  v_org record;
  v_team_name text;
  v_default_teams text[] := array[
    'Venda Veículos Novos',
    'Setor de Peças',
    'Setor de Pós-Vendas',
    'Gerência'
  ];
begin
  for v_org in select id from public.organizations loop
    foreach v_team_name in array v_default_teams loop
      insert into public.teams (org_id, name)
      values (v_org.id, v_team_name)
      on conflict (org_id, name) do nothing;
    end loop;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- fn_create_organization: organizações novas já nascem com os 4 setores
-- padrão. Mesma assinatura/retorno de antes — create or replace basta.
-- ---------------------------------------------------------------------------

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
    (v_org_id, 'Gerência');

  return query select v_org_id, v_slug;
end;
$$;
