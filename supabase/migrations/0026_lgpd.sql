-- 0026_lgpd.sql
-- Adequação à LGPD (tarefa 34): anonimizar contato (direito ao
-- esquecimento) e retenção automática opcional. Anonimizar em vez de
-- apagar (CLAUDE.md, regra 7): o negócio (lead, valor, etapa) continua
-- existindo pros relatórios; o que identifica a pessoa some. Idempotente.

alter table public.contacts
  add column if not exists anonymized_at timestamptz;

-- Meses sem nenhuma atividade até anonimizar sozinho. Nulo = desligado
-- (padrão): apagar dado pessoal automaticamente é decisão da empresa.
alter table public.organizations
  add column if not exists retention_months integer
    check (retention_months is null or retention_months between 6 and 120);

-- ---------------------------------------------------------------------------
-- Núcleo — sem checagem de permissão; só chamado pelas duas funções
-- abaixo (que checam) e nunca exposto direto.
-- ---------------------------------------------------------------------------
create or replace function public.fn_anonymize_contact_core(p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_digits text;
  v_org_id uuid;
begin
  select regexp_replace(phone_e164, '\D', '', 'g'), org_id into v_digits, v_org_id
  from public.contacts where id = p_contact_id and anonymized_at is null
  for update;
  if not found then
    return;
  end if;

  update public.contacts
  set name = 'Contato anonimizado',
      phone_e164 = 'anon-' || id::text,
      email = null,
      opted_in = false,
      opted_out_at = coalesce(opted_out_at, now()),
      anonymized_at = now()
  where id = p_contact_id;

  update public.messages
  set content = jsonb_build_object('body', '[conteúdo removido — LGPD]')
  where conversation_id in (select id from public.conversations where contact_id = p_contact_id);

  update public.consents
  set revoked_at = coalesce(revoked_at, now())
  where contact_id = p_contact_id;

  delete from public.bulk_campaign_recipients
  where contact_id = p_contact_id and status = 'pending';

  -- A entrega bruta do webhook e a fila guardam telefone e texto da
  -- mensagem — sem limpar aqui, o dado continuaria no banco. Sempre
  -- restrito à organização do contato: sem isso, um admin da empresa A
  -- cadastrando o telefone de um cliente da empresa B e anonimizando
  -- apagaria registros da B. Na fila, só evento já processado — um
  -- pendente com o payload apagado quebraria o processamento.
  -- Comparação exata nos campos de telefone do payload da Meta (não busca
  -- por trecho de texto: 8 dígitos soltos aparecem dentro de horário e de
  -- wamid e apagariam registros sem relação nenhuma com a pessoa).
  if length(v_digits) >= 8 then
    update public.webhook_deliveries
    set payload = jsonb_build_object('redacted', 'lgpd')
    where org_id = v_org_id
      and (
        payload -> 'value' -> 'contacts' @> jsonb_build_array(jsonb_build_object('wa_id', v_digits))
        or payload -> 'value' -> 'messages' @> jsonb_build_array(jsonb_build_object('from', v_digits))
        or payload -> 'value' -> 'statuses' @> jsonb_build_array(jsonb_build_object('recipient_id', v_digits))
      );

    update public.event_log
    set payload = jsonb_build_object('redacted', 'lgpd')
    where org_id = v_org_id
      and status in ('done', 'dead')
      and payload ->> 'wa_id' = v_digits;
  end if;
end;
$$;

revoke all on function public.fn_anonymize_contact_core(uuid) from public, anon, authenticated;

-- Pela tela: só admin/dono da organização do contato.
create or replace function public.fn_anonymize_contact(p_org_id uuid, p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- SECURITY DEFINER passa por cima da RLS — inclusive da regra do 2FA
  -- (0025). Sem esta linha, senha roubada sem o código chamaria isto direto.
  if not public.fn_mfa_ok() then
    raise exception 'mfa_required';
  end if;

  if not exists (
    select 1 from public.org_members
    where org_id = p_org_id and user_id = auth.uid() and accepted_at is not null and role in ('admin', 'owner')
  ) then
    raise exception 'forbidden';
  end if;

  if not exists (select 1 from public.contacts where id = p_contact_id and org_id = p_org_id) then
    raise exception 'not_found';
  end if;

  perform public.fn_anonymize_contact_core(p_contact_id);
end;
$$;

revoke all on function public.fn_anonymize_contact(uuid, uuid) from public, anon;
grant execute on function public.fn_anonymize_contact(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Retenção automática — só o worker (cron). Inativo = contato, conversas e
-- leads sem nenhuma mudança no prazo, e nenhum lead em aberto.
-- ---------------------------------------------------------------------------
create or replace function public.fn_retention_sweep(p_limit integer default 100)
returns table (org_id uuid, contact_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    select c.id, c.org_id
    from public.contacts c
    join public.organizations o on o.id = c.org_id
    where o.retention_months is not null
      and c.anonymized_at is null
      and c.updated_at < now() - make_interval(months => o.retention_months)
      and not exists (
        select 1 from public.leads l
        where l.contact_id = c.id
          and (l.status = 'open' or l.updated_at >= now() - make_interval(months => o.retention_months))
      )
      and not exists (
        select 1 from public.conversations cv
        where cv.contact_id = c.id
          and greatest(cv.updated_at, cv.last_inbound_at, cv.last_outbound_at) >= now() - make_interval(months => o.retention_months)
      )
    order by c.updated_at
    limit p_limit
  loop
    perform public.fn_anonymize_contact_core(r.id);
    org_id := r.org_id;
    contact_id := r.id;
    return next;
  end loop;
end;
$$;

revoke all on function public.fn_retention_sweep(integer) from public, anon, authenticated;
grant execute on function public.fn_retention_sweep(integer) to service_role;
