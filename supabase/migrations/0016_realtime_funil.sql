-- 0016_realtime_funil.sql
-- Habilita Realtime em leads/pipeline_stages — sem isso, INSERT/UPDATE
-- nessas tabelas não chega em nenhum client inscrito via supabase-js
-- (mesma necessidade de messages/conversations na migration 0012 e
-- profiles na 0013). Idempotente.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'leads'
  ) then
    alter publication supabase_realtime add table public.leads;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'pipeline_stages'
  ) then
    alter publication supabase_realtime add table public.pipeline_stages;
  end if;
end $$;
