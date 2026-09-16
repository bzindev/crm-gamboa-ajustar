-- 0001_baseline.sql
-- Schema mínimo para Fase 1 (fundação/RBAC) e Fase 2 (canal WhatsApp conectado).
-- Idempotente: pode rodar duas vezes sem quebrar.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.fn_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Organizações e pessoas (Fase 1)
-- ---------------------------------------------------------------------------

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.fn_set_updated_at();

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.fn_set_updated_at();

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'manager', 'agent')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

-- Função central de isolamento: a quais organizações o usuário autenticado
-- pertence. security definer é necessário porque a política de RLS de
-- org_members não pode consultar a própria tabela sem recursão.
create or replace function public.fn_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and accepted_at is not null
$$;

-- ---------------------------------------------------------------------------
-- Canal WhatsApp (Fase 2)
-- ---------------------------------------------------------------------------

create table if not exists public.channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  waba_id text not null,
  phone_number_id text not null unique,
  display_phone_number text,
  access_token_encrypted bytea,
  status text not null default 'disconnected'
    check (status in ('connected', 'disconnected', 'error')),
  last_health_check_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_channels_updated_at on public.channels;
create trigger trg_channels_updated_at
  before update on public.channels
  for each row execute function public.fn_set_updated_at();

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  phone_e164 text not null,
  name text,
  opted_in boolean not null default false,
  opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, phone_e164)
);

drop trigger if exists trg_contacts_updated_at on public.contacts;
create trigger trg_contacts_updated_at
  before update on public.contacts
  for each row execute function public.fn_set_updated_at();

create table if not exists public.consents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  source text not null,
  consented_at timestamptz not null default now(),
  revoked_at timestamptz,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  channel_id uuid not null references public.channels(id) on delete cascade,
  status text not null default 'open'
    check (status in ('open', 'pending', 'resolved', 'closed')),
  assigned_to uuid references public.profiles(id) on delete set null,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_conversations_org_status
  on public.conversations (org_id, status);

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
  before update on public.conversations
  for each row execute function public.fn_set_updated_at();

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  wamid text,
  direction text not null check (direction in ('inbound', 'outbound')),
  type text not null
    check (type in ('text', 'image', 'audio', 'video', 'document', 'template', 'sticker', 'location', 'contacts')),
  content jsonb,
  media_path text,
  status text not null default 'received'
    check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  error_code text,
  error_message text,
  sent_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Idempotência: a Meta reentrega webhook; o mesmo wamid não pode virar
-- duas linhas. Parcial porque uma mensagem de saída pode ser criada antes
-- da Meta confirmar e devolver o wamid.
create unique index if not exists uq_messages_org_wamid
  on public.messages (org_id, wamid)
  where wamid is not null;

create index if not exists idx_messages_conversation_created
  on public.messages (conversation_id, created_at);

-- ---------------------------------------------------------------------------
-- Infra: fila, auditoria, entrega bruta de webhook (Fase 2)
-- ---------------------------------------------------------------------------

create table if not exists public.webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  phone_number_id text,
  payload jsonb not null,
  signature_valid boolean not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create table if not exists public.event_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete set null,
  type text not null,
  payload jsonb not null,
  dedupe_key text unique,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed', 'dead')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists idx_event_log_status_created
  on public.event_log (status, created_at)
  where status = 'pending';

-- Append-only: nenhum papel de aplicação recebe update/delete.
create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  resource_type text not null,
  resource_id uuid,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.org_members enable row level security;
alter table public.channels enable row level security;
alter table public.contacts enable row level security;
alter table public.consents enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.webhook_deliveries enable row level security;
alter table public.event_log enable row level security;
alter table public.audit_log enable row level security;

-- organizations: só quem é membro aceito enxerga a própria organização.
drop policy if exists tenant_isolation_organizations on public.organizations;
create policy tenant_isolation_organizations on public.organizations
  for select using (id in (select fn_user_org_ids()));

-- profiles: o próprio usuário, ou perfil de alguém que divide organização.
drop policy if exists self_or_org_peer_profiles on public.profiles;
create policy self_or_org_peer_profiles on public.profiles
  for select using (
    id = auth.uid()
    or id in (
      select om.user_id
      from public.org_members om
      where om.org_id in (select fn_user_org_ids())
    )
  );

drop policy if exists self_update_profiles on public.profiles;
create policy self_update_profiles on public.profiles
  for update using (id = auth.uid());

-- org_members: só enxerga membros da própria organização.
drop policy if exists tenant_isolation_org_members on public.org_members;
create policy tenant_isolation_org_members on public.org_members
  for select using (org_id in (select fn_user_org_ids()));

-- Demais tabelas tenant-aware: mesmo padrão de isolamento por org_id.
-- Usamos "for all" (select+insert+update+delete) direto onde não há
-- distinção de leitura/escrita a fazer na RLS — a permissão fina por papel
-- (quem pode editar o quê) é responsabilidade do Route Handler, não da RLS.
drop policy if exists tenant_isolation_consents on public.consents;
create policy tenant_isolation_consents on public.consents
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_webhook_deliveries on public.webhook_deliveries;
create policy tenant_isolation_webhook_deliveries on public.webhook_deliveries
  for select using (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_event_log on public.event_log;
create policy tenant_isolation_event_log on public.event_log
  for select using (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_isolation_audit_log on public.audit_log;
create policy tenant_isolation_audit_log on public.audit_log
  for select using (org_id in (select fn_user_org_ids()));

-- audit_log é apêndice puro: revoga update/delete de todos os papéis de app.
revoke update, delete on public.audit_log from authenticated, anon;

-- Escrita (insert/update) nas tabelas operacionais fica restrita ao mesmo
-- escopo de organização; a validação de PAPEL (quem pode editar o quê)
-- acontece no Route Handler, não aqui — RLS é o limite de organização, não
-- o limite de permissão fina.
drop policy if exists tenant_write_channels on public.channels;
create policy tenant_write_channels on public.channels
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_write_contacts on public.contacts;
create policy tenant_write_contacts on public.contacts
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_write_conversations on public.conversations;
create policy tenant_write_conversations on public.conversations
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

drop policy if exists tenant_write_messages on public.messages;
create policy tenant_write_messages on public.messages
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));
