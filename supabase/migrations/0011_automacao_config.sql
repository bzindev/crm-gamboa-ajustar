-- 0011_automacao_config.sql
-- Configuração da automação de "lead parado" (hoje fixa em 3 dias no
-- código) vira um número por organização, ajustável pela tela de
-- Automações. Idempotente.

alter table public.organizations
  add column if not exists stage_alert_days integer not null default 3
    check (stage_alert_days > 0);
