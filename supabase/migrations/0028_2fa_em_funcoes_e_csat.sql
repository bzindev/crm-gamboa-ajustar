-- 0028_2fa_em_funcoes_e_csat.sql
-- Ajustes vindos da revisão de segurança da rodada 0021–0027. Idempotente.

-- ---------------------------------------------------------------------------
-- 1) Rodízio: SECURITY DEFINER passa por cima da RLS, inclusive da regra do
-- 2FA (0025) — sem esta checagem, uma sessão só com senha (aal1) de quem
-- ativou 2FA ainda mexeria no rodízio chamando a RPC direto. O worker
-- (service role, auth.uid() nulo) não é afetado. Resto igual à 0013.
-- ---------------------------------------------------------------------------
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
  if auth.uid() is not null and not public.fn_mfa_ok() then
    raise exception 'mfa_required';
  end if;

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

-- ---------------------------------------------------------------------------
-- 2) CSAT: nota é do CLIENTE. Com "for all", qualquer membro gravava direto
-- pela API (inclusive se autoavaliar). Agora: membro só LÊ; quem escreve é
-- o worker (service role) e a função abaixo, que cria a pesquisa pendente
-- tirando org/contato/vendedor da própria conversa — nada vem do cliente.
-- ---------------------------------------------------------------------------
drop policy if exists tenant_isolation_csat_surveys on public.csat_surveys;
create policy tenant_isolation_csat_surveys on public.csat_surveys
  for select using (org_id in (select fn_user_org_ids()));

create or replace function public.fn_queue_csat_survey(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv record;
begin
  if not public.fn_mfa_ok() then
    raise exception 'mfa_required';
  end if;

  select c.id, c.org_id, c.contact_id, c.assigned_to, c.status, o.csat_enabled
  into v_conv
  from public.conversations c
  join public.organizations o on o.id = c.org_id
  where c.id = p_conversation_id
    and c.org_id in (select public.fn_user_org_ids());

  -- Só conversa desta pessoa, de fato resolvida, com a pesquisa ligada.
  if not found or v_conv.status <> 'resolved' or not v_conv.csat_enabled then
    return;
  end if;

  -- Não repete se já teve pesquisa pra essa conversa nas últimas 24h.
  if exists (
    select 1 from public.csat_surveys s
    where s.conversation_id = p_conversation_id and s.created_at >= now() - interval '24 hours'
  ) then
    return;
  end if;

  insert into public.csat_surveys (org_id, conversation_id, contact_id, agent_id)
  values (v_conv.org_id, v_conv.id, v_conv.contact_id, v_conv.assigned_to);
end;
$$;

revoke all on function public.fn_queue_csat_survey(uuid) from public, anon;
grant execute on function public.fn_queue_csat_survey(uuid) to authenticated, service_role;
