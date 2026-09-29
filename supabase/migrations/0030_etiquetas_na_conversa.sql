-- 0030_etiquetas_na_conversa.sql
-- Temperatura (quente/morno/frio) e etiquetas nas conversas do Inbox.
-- Reaproveita a tabela `tags` do Funil — mesmo vocabulário nos dois
-- lugares (uma etiqueta "VIP" é a mesma na conversa e no lead). Idempotente.

alter table public.conversations
  add column if not exists temperature text check (temperature in ('cold', 'warm', 'hot'));

create table if not exists public.conversation_tags (
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (conversation_id, tag_id)
);

create index if not exists idx_conversation_tags_tag on public.conversation_tags (tag_id);

alter table public.conversation_tags enable row level security;

drop policy if exists tenant_isolation_conversation_tags on public.conversation_tags;
create policy tenant_isolation_conversation_tags on public.conversation_tags
  for all using (org_id in (select fn_user_org_ids()))
  with check (org_id in (select fn_user_org_ids()));

-- Tabela nova precisa declarar a regra do 2FA (0025 só cobriu as antigas).
drop policy if exists mfa_required on public.conversation_tags;
create policy mfa_required on public.conversation_tags
  as restrictive for all to authenticated
  using ((select public.fn_mfa_ok())) with check ((select public.fn_mfa_ok()));

revoke truncate on public.conversation_tags from anon, authenticated;

-- Lista do Inbox atualiza sozinha quando alguém etiqueta uma conversa.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_tags'
  ) then
    alter publication supabase_realtime add table public.conversation_tags;
  end if;
end $$;
