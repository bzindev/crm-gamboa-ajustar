-- 0006_fn_claim_pending_events.sql
-- PostgREST (a API que o supabase-js usa) não expõe "SELECT ... FOR UPDATE
-- SKIP LOCKED" — não dá para pedir lock de linha pela API REST. Para o
-- worker reivindicar um lote de event_log sem duas execuções concorrentes
-- pegarem a mesma linha, isso precisa ser uma função no banco. A função
-- marca pending -> processing atomicamente e devolve só o que ela mesma
-- reivindicou. Idempotente.

create or replace function public.fn_claim_pending_events(p_limit int default 20)
returns setof public.event_log
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.event_log
  set status = 'processing'
  where id in (
    select id
    from public.event_log
    where status = 'pending'
    order by created_at
    limit p_limit
    for update skip locked
  )
  returning *;
end;
$$;

-- Só o worker (service role) reivindica lote — nenhum papel de aplicação
-- deveria chamar isso diretamente.
revoke all on function public.fn_claim_pending_events(int) from public, anon, authenticated;
grant execute on function public.fn_claim_pending_events(int) to service_role;
