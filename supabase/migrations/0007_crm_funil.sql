-- 0007_crm_funil.sql
-- Fase 4: funil de vendas (pipelines, etapas, leads), tags, e o pipeline
-- padrão que toda organização nova já ganha (sem isso, ninguém consegue
-- usar o funil até configurar algo à mão primeiro). Idempotente.

create table if not exists public.pipelines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  is_default boolean not null default false,
  vocabulary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pipelines_updated_at on public.pipelines;
create trigger trg_pipelines_updated_at
  before update on public.pipelines
  for each row execute function public.fn_set_updated_at();

create table if not exists public.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  name text not null,
  position numeric not null,
  is_won boolean not null default false,
  is_lost boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_pipeline_stages_pipeline
  on public.pipeline_stages (pipeline_id, position);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  pipeline_id uuid not null references public.pipelines(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null,
  value_cents integer,
  position numeric not null default 0,
  owner_id uuid references public.profiles(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'won', 'lost')),
  lost_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_leads_stage on public.leads (stage_id, position);
create index if not exists idx_leads_org_status on public.leads (org_id, status);

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
  before update on public.leads
  for each row execute function public.fn_set_updated_at();

create table if not exists public.tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default '#71717a',
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table if not exists public.lead_tags (
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  primary key (lead_id, tag_id)
);

-- ---------------------------------------------------------------------------
-- RLS — mesmo padrão das demais tabelas tenant-aware: limite de organização
-- aqui, permissão fina (quem pode editar o quê) no Server Action.
-- ---------------------------------------------------------------------------

alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.tags enable row level security;
alter table public.lead_tags enable row level security;

drop policy if exists tenant_isolation_pipelines on public.pipelines;
create policy tenant_isolation_pipelines on public.pipelines
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_pipeline_stages on public.pipeline_stages;
create policy tenant_isolation_pipeline_stages on public.pipeline_stages
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_leads on public.leads;
create policy tenant_isolation_leads on public.leads
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_tags on public.tags;
create policy tenant_isolation_tags on public.tags
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_lead_tags on public.lead_tags;
create policy tenant_isolation_lead_tags on public.lead_tags
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

-- ---------------------------------------------------------------------------
-- fn_create_organization agora também semeia um pipeline padrão. Mesma
-- assinatura e mesmo retorno de antes — create or replace basta, não
-- precisa apagar a função.
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
      'won_label', 'Ganho',
      'lost_label', 'Perdido'
    )
  )
  returning id into v_pipeline_id;

  insert into public.pipeline_stages (org_id, pipeline_id, name, position, is_won, is_lost)
  values
    (v_org_id, v_pipeline_id, 'Novo', 1, false, false),
    (v_org_id, v_pipeline_id, 'Em contato', 2, false, false),
    (v_org_id, v_pipeline_id, 'Proposta', 3, false, false),
    (v_org_id, v_pipeline_id, 'Fechado', 4, true, false);

  return query select v_org_id, v_slug;
end;
$$;

-- ---------------------------------------------------------------------------
-- Backfill: organizações criadas antes desta migration não passaram pela
-- semeadura de pipeline acima — sem isso, "Renault Gamboa" (e qualquer
-- outra já existente) ficaria com o Funil vazio e sem etapa nenhuma.
-- Idempotente: só mexe em organização que ainda não tem pipeline.
-- ---------------------------------------------------------------------------

do $$
declare
  v_org record;
  v_pipeline_id uuid;
begin
  for v_org in
    select o.id
    from public.organizations o
    where not exists (select 1 from public.pipelines p where p.org_id = o.id)
  loop
    insert into public.pipelines (org_id, name, is_default, vocabulary)
    values (
      v_org.id,
      'Vendas',
      true,
      jsonb_build_object(
        'lead_singular', 'Lead',
        'lead_plural', 'Leads',
        'won_label', 'Ganho',
        'lost_label', 'Perdido'
      )
    )
    returning id into v_pipeline_id;

    insert into public.pipeline_stages (org_id, pipeline_id, name, position, is_won, is_lost)
    values
      (v_org.id, v_pipeline_id, 'Novo', 1, false, false),
      (v_org.id, v_pipeline_id, 'Em contato', 2, false, false),
      (v_org.id, v_pipeline_id, 'Proposta', 3, false, false),
      (v_org.id, v_pipeline_id, 'Fechado', 4, true, false);
  end loop;
end $$;
