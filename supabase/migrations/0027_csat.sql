-- 0027_csat.sql
-- Pesquisa de satisfação (tarefa 30): ao marcar a conversa como
-- resolvida, o cliente recebe uma pergunta de 1 a 5; a resposta vira nota.
-- Desligada por padrão. Idempotente.

alter table public.organizations
  add column if not exists csat_enabled boolean not null default false,
  add column if not exists csat_message text not null default
    'Obrigado pelo contato com a Renault Gamboa! De 1 a 5, que nota você dá pro nosso atendimento? Responda só com o número.';

create table if not exists public.csat_surveys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  -- Quem atendia quando a conversa foi resolvida — base da nota por vendedor.
  agent_id uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'answered', 'skipped', 'failed')),
  rating integer check (rating between 1 and 5),
  -- Mensagem do cliente que respondeu — torna o registro da resposta
  -- idempotente se o worker reprocessar a mesma mensagem.
  answer_wamid text,
  error_message text,
  sent_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_csat_surveys_conversation on public.csat_surveys (conversation_id, status);
create index if not exists idx_csat_surveys_pending on public.csat_surveys (status) where status = 'pending';

alter table public.csat_surveys enable row level security;

drop policy if exists tenant_isolation_csat_surveys on public.csat_surveys;
create policy tenant_isolation_csat_surveys on public.csat_surveys
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

-- Tabela nova não herda a regra do 2FA da migration 0025 (aquela só
-- percorreu as tabelas que existiam) — precisa declarar aqui.
drop policy if exists mfa_required on public.csat_surveys;
create policy mfa_required on public.csat_surveys
  as restrictive for all to authenticated
  using ((select public.fn_mfa_ok())) with check ((select public.fn_mfa_ok()));

revoke truncate on public.csat_surveys from anon, authenticated;
