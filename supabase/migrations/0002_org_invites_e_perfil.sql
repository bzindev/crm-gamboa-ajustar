-- 0002_org_invites_e_perfil.sql
-- Convite de membro por link + criação automática de profiles no cadastro.
-- Idempotente: pode rodar duas vezes sem quebrar.

create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null check (role in ('admin', 'manager', 'agent')),
  token text not null unique,
  invited_by uuid references public.profiles(id) on delete set null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_org_invites_org on public.org_invites (org_id);

alter table public.org_invites enable row level security;

-- Membros da própria organização podem ver e criar convites da própria
-- organização. A checagem de PAPEL (só admin/owner pode convidar) é feita
-- no Route Handler/Server Action, não aqui — RLS aqui é só o limite de
-- organização, igual às outras tabelas.
drop policy if exists tenant_isolation_org_invites on public.org_invites;
create policy tenant_isolation_org_invites on public.org_invites
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

-- A busca de um convite pelo token (fluxo de aceitar convite) é feita pelo
-- código do servidor com a service role, filtrando explicitamente por
-- token exato — de propósito, não por descuido: quem tem o token único é
-- quem tem permissão de ver aquele convite, mesmo antes de ser membro da
-- organização. Por isso não existe (e não deve existir) uma política de
-- RLS aqui que libere leitura anônima por token.

-- ---------------------------------------------------------------------------
-- Perfil criado automaticamente quando um usuário se cadastra.
-- ---------------------------------------------------------------------------

create or replace function public.fn_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_on_auth_user_created on auth.users;
create trigger trg_on_auth_user_created
  after insert on auth.users
  for each row execute function public.fn_handle_new_user();
