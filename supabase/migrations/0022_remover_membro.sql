-- 0022_remover_membro.sql
-- Remover alguém da organização. org_members só tem política de SELECT
-- (de propósito — ninguém apaga membro direto pela API), então a remoção é
-- uma função que confere as regras AQUI dentro e faz tudo numa transação
-- só: sem isso, dava pra ficar com a pessoa fora da organização mas ainda
-- dona de conversas/leads ou dentro do rodízio. Idempotente.

create or replace function public.fn_remove_org_member(p_org_id uuid, p_user_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_caller_role text;
  v_target_role text;
begin
  if v_caller is null then
    raise exception 'not_authenticated';
  end if;

  -- SECURITY DEFINER passa por cima da RLS — inclusive da regra do 2FA
  -- (0025). Sem esta checagem, senha roubada sem o código chamaria isto.
  -- (fn_mfa_ok vem da 0025, aplicada depois; esta versão foi reaplicada.)
  if not public.fn_mfa_ok() then
    raise exception 'mfa_required';
  end if;

  -- Quem chama precisa ser admin/dono DESTA organização — o p_org_id vem do
  -- cliente via RPC, então nunca é confiado sem essa checagem.
  select role into v_caller_role
  from public.org_members
  where org_id = p_org_id and user_id = v_caller and accepted_at is not null;

  if v_caller_role is null or v_caller_role not in ('admin', 'owner') then
    raise exception 'forbidden';
  end if;

  if p_user_id = v_caller then
    raise exception 'cannot_remove_self';
  end if;

  select role into v_target_role
  from public.org_members
  where org_id = p_org_id and user_id = p_user_id
  for update;

  if v_target_role is null then
    raise exception 'not_found';
  end if;
  if v_target_role = 'owner' then
    raise exception 'cannot_remove_owner';
  end if;
  -- Admin não remove outro admin; só o dono.
  if v_target_role = 'admin' and v_caller_role <> 'owner' then
    raise exception 'forbidden';
  end if;

  -- Trabalho em aberto volta pra fila (alguém assume / rodízio). Lead já
  -- ganho ou perdido mantém o dono — é histórico, alimenta relatório.
  update public.conversations
  set assigned_to = null, assigned_at = null
  where org_id = p_org_id and assigned_to = p_user_id;

  update public.leads
  set owner_id = null
  where org_id = p_org_id and owner_id = p_user_id and status = 'open';

  delete from public.team_members where org_id = p_org_id and user_id = p_user_id;

  update public.teams
  set last_assigned_member_id = null
  where org_id = p_org_id and last_assigned_member_id = p_user_id;

  delete from public.org_members where org_id = p_org_id and user_id = p_user_id;

  return v_target_role;
end;
$$;

revoke all on function public.fn_remove_org_member(uuid, uuid) from public, anon;
grant execute on function public.fn_remove_org_member(uuid, uuid) to authenticated, service_role;
