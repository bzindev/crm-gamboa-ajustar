-- 0015_disparo_em_massa.sql
-- Templates de mensagem (aprovação da Meta) + campanhas de disparo em
-- massa + fila de destinatários. Idempotente.

-- --- Templates ----------------------------------------------------------
-- Espelha o que a Meta guarda pro template (nome, idioma, categoria,
-- corpo) + o status de aprovação. Fora da janela de 24h, só dá pra iniciar
-- conversa com um template já aprovado — daí esta tabela existir antes da
-- de campanhas.
create table if not exists public.message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  language text not null default 'pt_BR',
  category text not null check (category in ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
  body_text text not null,
  variable_count integer not null default 0 check (variable_count in (0, 1)),
  meta_template_id text,
  status text not null default 'draft'
    check (status in ('draft', 'pending', 'approved', 'rejected')),
  rejected_reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name, language)
);

drop trigger if exists trg_message_templates_updated_at on public.message_templates;
create trigger trg_message_templates_updated_at
  before update on public.message_templates
  for each row execute function public.fn_set_updated_at();

alter table public.message_templates enable row level security;

drop policy if exists tenant_isolation_message_templates on public.message_templates;
create policy tenant_isolation_message_templates on public.message_templates
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

-- --- Campanhas ------------------------------------------------------------
create table if not exists public.bulk_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  template_id uuid not null references public.message_templates(id) on delete restrict,
  created_by uuid references public.profiles(id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'sending', 'done', 'failed')),
  total_recipients integer not null default 0,
  sent_count integer not null default 0,
  failed_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_bulk_campaigns_updated_at on public.bulk_campaigns;
create trigger trg_bulk_campaigns_updated_at
  before update on public.bulk_campaigns
  for each row execute function public.fn_set_updated_at();

alter table public.bulk_campaigns enable row level security;

drop policy if exists tenant_isolation_bulk_campaigns on public.bulk_campaigns;
create policy tenant_isolation_bulk_campaigns on public.bulk_campaigns
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

-- --- Destinatários --------------------------------------------------------
-- Ficha de cada contato dentro da campanha — o event_log (fila genérica já
-- existente) só carrega "processe o destinatário X da campanha Y"; quem
-- destino/status/erro final para exibir na tela é esta tabela, igual
-- messages/conversations já são o "domínio" por trás da fila de webhook.
create table if not exists public.bulk_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.bulk_campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped_no_consent')),
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (campaign_id, contact_id)
);

create index if not exists idx_bulk_campaign_recipients_status
  on public.bulk_campaign_recipients (campaign_id, status);

alter table public.bulk_campaign_recipients enable row level security;

drop policy if exists tenant_isolation_bulk_campaign_recipients on public.bulk_campaign_recipients;
create policy tenant_isolation_bulk_campaign_recipients on public.bulk_campaign_recipients
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));
