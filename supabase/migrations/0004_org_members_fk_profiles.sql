-- 0004_org_members_fk_profiles.sql
-- org_members.user_id apontava para auth.users(id). Funcionalmente correto
-- (é o mesmo id), mas sem uma foreign key direta para public.profiles, o
-- PostgREST (usado pelo supabase-js) não consegue montar automaticamente o
-- "join" org_members -> profiles em uma única consulta (select("...,
-- profiles(full_name)")) — é assim que a tela de Equipe descobre o nome de
-- cada membro. Todo usuário já tem uma linha em profiles antes de poder
-- entrar em qualquer org_members (o trigger de 0002 cria o profile no
-- cadastro, antes de existir qualquer chance de chamar fn_create_organization
-- ou fn_accept_invite), então apontar para profiles(id) em vez de
-- auth.users(id) é seguro e não perde nenhuma garantia. Idempotente.

alter table public.org_members
  drop constraint if exists org_members_user_id_fkey;

alter table public.org_members
  add constraint org_members_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete cascade;
