-- 0014_contatos_email.sql
-- E-mail opcional no contato + bloqueio de duplicidade (telefone já tinha
-- unique constraint desde o baseline; e-mail ganha o mesmo tratamento
-- agora que a importação/cadastro passa a aceitar esse campo). Idempotente.

alter table public.contacts
  add column if not exists email text;

-- Parcial (só quando preenchido) e case-insensitive — "Joao@x.com" e
-- "joao@x.com" são o mesmo contato pra fins de duplicidade.
create unique index if not exists uq_contacts_org_email
  on public.contacts (org_id, lower(email))
  where email is not null;
