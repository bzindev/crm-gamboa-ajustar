-- 0003_fn_organizacoes_e_convites.sql
-- Funções security definer para as duas operações que "atravessam a
-- fronteira" de organização por natureza: criar a primeira organização
-- (o usuário ainda não é membro de nada) e aceitar um convite (o usuário
-- ainda não é membro daquela organização específica). Nos dois casos, uma
-- política de RLS comum ("org_id in fn_user_org_ids()") não tem como
-- autorizar, porque a autorização não vem de já pertencer à organização —
-- vem de ter acabado de criá-la, ou de ter o token do convite.
--
-- Por isso essas duas ações viram função no banco em vez de INSERT direto
-- do código: a regra "quem pode fazer isso e quando" fica descrita uma
-- vez só, perto do dado, e nenhum outro caminho (uma rota nova, um bug de
-- app) consegue reproduzir a mesma escrita sem passar pelas mesmas
-- checagens. Idempotente: pode rodar duas vezes sem quebrar.

-- ---------------------------------------------------------------------------
-- Criar organização + tornar quem criou o dono (owner) dela.
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
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  v_slug := regexp_replace(lower(trim(p_name)), '[^a-z0-9]+', '-', 'g');
  v_slug := trim(both '-' from v_slug);
  if v_slug = '' then
    v_slug := 'org';
  end if;
  -- Sufixo aleatório: mais simples que checar colisão e tentar de novo, e
  -- o slug não é uma URL pública amigável no MVP, só um identificador.
  v_slug := v_slug || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 6);

  insert into public.organizations (name, slug)
  values (trim(p_name), v_slug)
  returning id into v_org_id;

  insert into public.org_members (org_id, user_id, role, accepted_at)
  values (v_org_id, v_uid, 'owner', now());

  return query select v_org_id, v_slug;
end;
$$;

revoke all on function public.fn_create_organization(text) from public, anon;
grant execute on function public.fn_create_organization(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Prévia pública de um convite (sem exigir login) — só os campos
-- necessários para a tela decidir o que mostrar, nunca a linha inteira.
-- ---------------------------------------------------------------------------

create or replace function public.fn_get_invite_preview(p_token text)
returns table (
  org_name text,
  email text,
  role text,
  is_expired boolean,
  is_accepted boolean
)
language sql
security definer
set search_path = public
stable
as $$
  select
    o.name,
    i.email,
    i.role,
    (i.expires_at < now()),
    (i.accepted_at is not null)
  from public.org_invites i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;

revoke all on function public.fn_get_invite_preview(text) from public;
grant execute on function public.fn_get_invite_preview(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Aceitar convite: exige usuário autenticado com o mesmo e-mail do convite.
-- ---------------------------------------------------------------------------

create or replace function public.fn_accept_invite(p_token text)
returns table (org_id uuid, org_name text)
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
