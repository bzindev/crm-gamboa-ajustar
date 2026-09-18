-- 0008_leads_concessionaria.sql
-- Vocabulário de concessionária: campos novos no lead (veículo de interesse,
-- temperatura, origem, campanha) e troca das etapas padrão de
-- Novo/Em contato/Proposta/Fechado para o funil de vendas de veículo
-- (Lead/Em atendimento/Follow-up/Agendado/Compareceu/No-show/Venda/Perdido).
-- Idempotente: pode rodar duas vezes sem quebrar.

alter table public.leads
  add column if not exists vehicle_interest text,
  add column if not exists temperature text not null default 'cold'
    check (temperature in ('cold', 'warm', 'hot')),
  add column if not exists origin text,
  add column if not exists campaign text;

-- ---------------------------------------------------------------------------
-- Novas etapas padrão + migração dos dados existentes. Roda por pipeline
-- (uma organização pode, em teoria, ter mais de um pipeline no futuro —
-- hoje só existe o padrão, mas o loop já cobre isso).
-- ---------------------------------------------------------------------------

do $$
declare
  v_pipeline record;
  v_stage_lead uuid;
  v_stage_atendimento uuid;
  v_stage_followup uuid;
  v_stage_agendado uuid;
  v_stage_compareceu uuid;
  v_stage_noshow uuid;
  v_stage_venda uuid;
  v_stage_perdido uuid;
  v_old_novo uuid;
  v_old_contato uuid;
  v_old_proposta uuid;
  v_old_fechado uuid;
begin
  for v_pipeline in select id, org_id from public.pipelines loop
    -- Se este pipeline já tem uma etapa chamada "Lead", assume que a
    -- migração já rodou para ele (idempotência manual, já que "insert de
    -- etapa nova" não tem um "if not exists" natural por nome).
    if exists (
      select 1 from public.pipeline_stages
      where pipeline_id = v_pipeline.id and name = 'Lead'
    ) then
      continue;
    end if;

    insert into public.pipeline_stages (org_id, pipeline_id, name, position, is_won, is_lost)
    values
      (v_pipeline.org_id, v_pipeline.id, 'Lead', 1, false, false),
      (v_pipeline.org_id, v_pipeline.id, 'Em atendimento', 2, false, false),
      (v_pipeline.org_id, v_pipeline.id, 'Follow-up', 3, false, false),
      (v_pipeline.org_id, v_pipeline.id, 'Agendado', 4, false, false),
      (v_pipeline.org_id, v_pipeline.id, 'Compareceu', 5, false, false),
      (v_pipeline.org_id, v_pipeline.id, 'No-show', 6, false, false),
      (v_pipeline.org_id, v_pipeline.id, 'Venda', 7, true, false),
      (v_pipeline.org_id, v_pipeline.id, 'Perdido', 8, false, true);

    select id into v_stage_lead from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Lead';
    select id into v_stage_atendimento from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Em atendimento';
    select id into v_stage_followup from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Follow-up';
    select id into v_stage_venda from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Venda';
    select id into v_stage_perdido from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Perdido';

    select id into v_old_novo from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Novo';
    select id into v_old_contato from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Em contato';
    select id into v_old_proposta from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Proposta';
    select id into v_old_fechado from public.pipeline_stages where pipeline_id = v_pipeline.id and name = 'Fechado';

    -- Redistribui leads das etapas antigas: won -> Venda, lost -> Perdido,
    -- em aberto segue a correspondência mais próxima de estágio.
    if v_old_novo is not null then
      update public.leads set stage_id = v_stage_lead where stage_id = v_old_novo;
    end if;
    if v_old_contato is not null then
      update public.leads set stage_id = v_stage_atendimento where stage_id = v_old_contato;
    end if;
    if v_old_proposta is not null then
      update public.leads set stage_id = v_stage_followup where stage_id = v_old_proposta;
    end if;
    if v_old_fechado is not null then
      update public.leads set stage_id = v_stage_venda where stage_id = v_old_fechado and status = 'won';
      update public.leads set stage_id = v_stage_perdido where stage_id = v_old_fechado and status = 'lost';
      -- qualquer sobra (aberto numa etapa "Fechado", não deveria existir)
      -- cai em Follow-up em vez de travar a migration.
      update public.leads set stage_id = v_stage_followup where stage_id = v_old_fechado;
    end if;

    -- Agora que nenhum lead referencia as etapas antigas, pode apagar.
    delete from public.pipeline_stages
    where pipeline_id = v_pipeline.id
      and name in ('Novo', 'Em contato', 'Proposta', 'Fechado');

    -- Vocabulário: "Ganho" vira "Venda" para bater com o nome da etapa.
    update public.pipelines
    set vocabulary = vocabulary || jsonb_build_object('won_label', 'Venda')
    where id = v_pipeline.id;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- fn_create_organization: organizações novas já nascem com o funil de
-- concessionária, não mais o genérico de 4 etapas.
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

  return query select v_org_id, v_slug;
end;
$$;
