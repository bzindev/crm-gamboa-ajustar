-- 0023_respostas_rapidas.sql
-- Mensagens prontas da organização pra agilizar o atendimento (tarefa 21).
-- Diferente de message_templates (0015): aquilo é template oficial da
-- Meta, aprovado, pra iniciar conversa fora da janela de 24h; isto aqui é
-- só texto pronto que o vendedor insere no campo e ainda pode editar antes
-- de mandar, dentro da janela. Idempotente.

create table if not exists public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  body text not null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, title)
);

drop trigger if exists trg_quick_replies_updated_at on public.quick_replies;
create trigger trg_quick_replies_updated_at
  before update on public.quick_replies
  for each row execute function public.fn_set_updated_at();

alter table public.quick_replies enable row level security;

drop policy if exists tenant_isolation_quick_replies on public.quick_replies;
create policy tenant_isolation_quick_replies on public.quick_replies
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

revoke truncate on public.quick_replies from anon, authenticated;
