-- 0012_notifications_e_realtime.sql
-- Notificações (sino do topo) + habilita Realtime em messages/conversations
-- para o chat atualizar sozinho sem precisar navegar/recarregar. Idempotente.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_user_unread
  on public.notifications (user_id, created_at desc)
  where read_at is null;

alter table public.notifications enable row level security;

-- Cada um só lê a própria caixa de notificação — diferente das outras
-- tabelas tenant-aware, aqui o limite não é só "mesma organização", é
-- "meu usuário". org_id continua sendo checado por segurança em
-- profundidade (defesa em camadas), não é a única barreira.
drop policy if exists own_notifications_select on public.notifications;
create policy own_notifications_select on public.notifications
  for select using (user_id = auth.uid() and org_id in (select fn_user_org_ids()));

-- Insert é mais aberto de propósito: notificar um colega (ex.: "lead
-- atribuído a você", "nova mensagem no WhatsApp") é sempre uma escrita
-- para OUTRO usuário da mesma organização, feita pela Server Action de
-- quem originou o evento — nunca pelo próprio destinatário. A RLS aqui só
-- garante o limite de organização; who-can-notify-whom não precisa de
-- regra fina, é sempre dentro do mesmo tenant.
drop policy if exists org_notifications_insert on public.notifications;
create policy org_notifications_insert on public.notifications
  for insert with check (org_id in (select fn_user_org_ids()));

-- Só o dono marca a própria notificação como lida.
drop policy if exists own_notifications_update on public.notifications;
create policy own_notifications_update on public.notifications
  for update using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Realtime: sem isso, INSERT/UPDATE nessas tabelas não chega nos clients
-- inscritos via supabase-js — precisa entrar explicitamente na publicação
-- lógica que o Supabase usa para replicar mudanças.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
