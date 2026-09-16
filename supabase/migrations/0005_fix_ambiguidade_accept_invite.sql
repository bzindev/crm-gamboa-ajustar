-- 0005_fix_ambiguidade_accept_invite.sql
-- fn_accept_invite tinha "returns table (org_id uuid, org_name text)". Em
-- PL/pgSQL, os nomes de RETURNS TABLE viram variáveis dentro da função —
-- e "org_id" colidia com a coluna org_members.org_id usada em
-- "on conflict (org_id, user_id)", causando o erro real do Postgres:
-- "42702: column reference org_id is ambiguous". Renomear os parâmetros de
-- saída (para nomes que nenhuma tabela usa) resolve sem mudar o
-- comportamento. Idempotente.

-- create or replace não permite trocar o nome/tipo das colunas de retorno
-- de uma função que já existe — precisa apagar antes de recriar.
drop function if exists public.fn_accept_invite(text);

create function public.fn_accept_invite(p_token text)
returns table (result_org_id uuid, result_org_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_user_email text;
  v_invite public.org_invites%rowtype;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_invite
  from public.org_invites
  where token = p_token
  for update;

  if not found then
    raise exception 'convite_invalido';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'convite_ja_usado';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'convite_expirado';
  end if;

  select email into v_user_email from auth.users where id = v_uid;

  if v_user_email is null or lower(v_user_email) is distinct from lower(v_invite.email) then
    raise exception 'email_nao_corresponde';
  end if;

  insert into public.org_members (org_id, user_id, role, accepted_at)
  values (v_invite.org_id, v_uid, v_invite.role, now())
  on conflict (org_id, user_id)
  do update set role = excluded.role, accepted_at = now();

  update public.org_invites set accepted_at = now() where id = v_invite.id;

  return query
  select o.id, o.name from public.organizations o where o.id = v_invite.org_id;
end;
$$;

revoke all on function public.fn_accept_invite(text) from public, anon;
grant execute on function public.fn_accept_invite(text) to authenticated;
