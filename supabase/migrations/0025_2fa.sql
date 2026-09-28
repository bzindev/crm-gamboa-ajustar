-- 0025_2fa.sql
-- Autenticação em duas etapas (tarefa 15). O desafio do código em si é
-- do Supabase Auth (TOTP); o que esta migration garante é que o 2FA não
-- seja só visual: quem ATIVOU o 2FA não lê nem grava nada sem ter digitado
-- o código nesta sessão (JWT com aal2) — nem chamando a API direto com uma
-- senha roubada. Quem não ativou continua funcionando igual. Idempotente.

-- security definer: authenticated não enxerga o schema auth (mfa_factors).
create or replace function public.fn_mfa_ok()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;

revoke all on function public.fn_mfa_ok() from public;
grant execute on function public.fn_mfa_ok() to anon, authenticated, service_role;

-- RESTRICTIVE: soma um "E" a todas as políticas que já existem em cada
-- tabela (isolamento por organização etc.) em vez de abrir nada novo.
-- "(select fn_mfa_ok())" faz o Postgres avaliar uma vez por consulta, não
-- uma vez por linha. Service role (worker) ignora RLS e não é afetado.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and rowsecurity loop
    execute format('drop policy if exists mfa_required on public.%I', t.tablename);
    execute format(
      'create policy mfa_required on public.%I as restrictive for all to authenticated
         using ((select public.fn_mfa_ok())) with check ((select public.fn_mfa_ok()))',
      t.tablename
    );
  end loop;
end $$;
