-- 0017_horario_expediente.sql
-- Horário de expediente da organização — usado pelo rodízio pra não
-- distribuir lead/conversa automaticamente fora do horário (fica sem dono
-- pra alguém pegar manualmente quando abrir, em vez de "acordar" um
-- vendedor às 22h). Idempotente.

alter table public.organizations
  add column if not exists business_hours jsonb not null default jsonb_build_object(
    'weekday_open', '08:00',
    'weekday_close', '18:00',
    'saturday_enabled', false,
    'saturday_open', '08:00',
    'saturday_close', '13:00'
  );
