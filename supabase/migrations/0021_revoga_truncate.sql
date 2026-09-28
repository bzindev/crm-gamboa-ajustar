-- 0021_revoga_truncate.sql
-- O Supabase concede TRUNCATE a anon/authenticated em toda tabela nova por
-- padrão. TRUNCATE ignora RLS por completo — no audit_log isso contradiz a
-- regra "append-only, sem apagar" (CLAUDE.md, regra 4). A API REST não
-- expõe TRUNCATE, então não era explorável pelo app, mas nenhum papel de
-- aplicação precisa disso em tabela nenhuma. Idempotente.

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('revoke truncate on public.%I from anon, authenticated', t.tablename);
  end loop;
end $$;

-- Tabelas criadas daqui pra frente já nascem sem esse privilégio.
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
