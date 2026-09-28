-- 0024_metas.sql
-- Metas mensais (tarefa 25): da equipe inteira (user_id nulo) ou de um
-- vendedor. Progresso é calculado na hora a partir dos leads ganhos no mês
-- — não guarda contador, pra nunca ficar dessincronizado. Idempotente.

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  target_won integer not null check (target_won > 0),
  target_value_cents bigint check (target_value_cents is null or target_value_cents > 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- "nulls not distinct": uma meta de EQUIPE por mês também (user_id nulo
  -- contaria como distinto num unique comum e deixaria duplicar).
  constraint uq_goals_org_user_month unique nulls not distinct (org_id, user_id, month)
);

drop trigger if exists trg_goals_updated_at on public.goals;
create trigger trg_goals_updated_at
  before update on public.goals
  for each row execute function public.fn_set_updated_at();

alter table public.goals enable row level security;

drop policy if exists tenant_isolation_goals on public.goals;
create policy tenant_isolation_goals on public.goals
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

revoke truncate on public.goals from anon, authenticated;
