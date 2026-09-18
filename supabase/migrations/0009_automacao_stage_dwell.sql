-- 0009_automacao_stage_dwell.sql
-- Base para automação simples: saber há quanto tempo um lead está parado na
-- etapa atual (para alertar follow-up), sem precisar de worker/cron ainda —
-- só uma coluna atualizada por trigger e uma linha de histórico em
-- event_log (trigger nunca faz HTTP, só insere linha — regra 3 do
-- CLAUDE.md). Idempotente.

alter table public.leads
  add column if not exists stage_entered_at timestamptz not null default now();

-- BEFORE UPDATE: reseta o relógio da etapa sempre que ela muda.
create or replace function public.fn_leads_reset_stage_clock()
returns trigger
language plpgsql
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_reset_stage_clock on public.leads;
create trigger trg_leads_reset_stage_clock
  before update on public.leads
  for each row execute function public.fn_leads_reset_stage_clock();

-- AFTER UPDATE: grava o histórico em event_log. security definer porque só
-- existe policy de SELECT em event_log para o papel authenticated — quem
-- grava de verdade é o worker (service role) ou, aqui, uma trigger que
-- precisa desse mesmo privilégio para o próprio INSERT interno.
create or replace function public.fn_leads_log_stage_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.stage_id is distinct from old.stage_id then
    insert into public.event_log (org_id, type, payload, dedupe_key)
    values (
      new.org_id,
      'lead_stage_changed',
      jsonb_build_object(
        'lead_id', new.id,
        'from_stage_id', old.stage_id,
        'to_stage_id', new.stage_id,
        'changed_at', now()
      ),
      'lead_stage_changed:' || new.id || ':' || extract(epoch from clock_timestamp())::text
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_leads_log_stage_change on public.leads;
create trigger trg_leads_log_stage_change
  after update on public.leads
  for each row execute function public.fn_leads_log_stage_change();

-- ---------------------------------------------------------------------------
-- audit_log só tinha política de SELECT desde o baseline (0001) — nunca
-- houve como inserir. lib/audit/log.ts agora grava nele a partir do
-- código da aplicação (create/update/mover lead); sem essa policy, cada
-- chamada falharia silenciosamente. Continua sem UPDATE/DELETE (apêndice
-- puro) — só ganha o INSERT que faltava.
-- ---------------------------------------------------------------------------

-- actor_id precisa ser o próprio auth.uid() (ou nulo) — sem isso, qualquer
-- membro da organização poderia chamar o REST do Supabase direto (fora da
-- aplicação) e gravar uma linha de audit_log com actor_id de outra pessoa,
-- forjando "quem fez o quê". org_id continua sendo o limite de organização,
-- igual às outras tabelas.
drop policy if exists tenant_insert_audit_log on public.audit_log;
create policy tenant_insert_audit_log on public.audit_log
  for insert
  with check (
    org_id in (select fn_user_org_ids())
    and (actor_id = auth.uid() or actor_id is null)
  );
