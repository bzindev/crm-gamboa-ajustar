# Arquitetura — CRM WhatsApp (nome do projeto: `crm-whatsapp`, PREENCHER)

> Domínio de produção: `https://app.SEU-DOMINIO.com.br` (PREENCHER antes do deploy).
> Este documento é o resumo de uma página. Detalhe de tarefas está em `PLANO.md`,
> regras de convenção de código estão em `CLAUDE.md`, schema vivo está em
> `supabase/migrations/`.

## 1. Visão geral

CRM de atendimento e vendas por WhatsApp, multi-tenant. Uma instalação atende
várias organizações (`organizations`); RLS do Postgres é a linha de defesa que
impede uma organização de ler dado de outra — não a aplicação.

```
Cliente WhatsApp
      │
      ▼
Meta Cloud API (Graph API, número oficial)
      │  webhook assinado (HMAC SHA-256)
      ▼
POST /api/webhooks/whatsapp  (Next.js Route Handler)
      │  1. valida assinatura do corpo cru
      │  2. grava payload bruto em webhook_deliveries
      │  3. resolve org_id pelo phone_number_id em channels
      │  4. enfileira em event_log
      │  5. responde 200
      ▼
event_log (fila em tabela)
      │  drenada por worker chamado via cron (Vercel Cron → endpoint /api/cron/*)
      ▼
Worker: baixa mídia, cria/atualiza contacts, conversations, messages
      │
      ▼
Supabase Realtime (postgres_changes em messages/conversations)
      │
      ▼
Inbox (Next.js, supabase-js com JWT do usuário → RLS aplica automaticamente)
```

## 2. Por que essas escolhas

- **`supabase-js` no runtime, não Drizzle/Prisma direto no Postgres.** O
  `supabase-js` propaga o JWT do usuário autenticado em cada query; é esse JWT
  que a política RLS do Postgres inspeciona para decidir quais linhas
  devolver. Um client de ORM tradicional conecta com a *connection string* do
  Postgres (via credencial de serviço) e o Postgres não sabe "de qual usuário"
  é aquela query — a RLS não tem o que checar, e a única coisa que ainda
  filtra por organização é o `WHERE` que alguém lembrou de escrever na query.
  Um `WHERE` esquecido em uma única rota é como dado de uma empresa vaza para
  outra. Rotas de servidor que legitimamente precisam ignorar RLS (o worker
  que drena a fila, por exemplo) usam a *service role key* explicitamente — e
  nesse caso o filtro por `org_id` fica sendo responsabilidade manual do
  código, documentada linha a linha onde acontece.
- **Fila via tabela (`event_log`) em vez de trigger chamando HTTP.** Uma
  trigger de banco que faz uma chamada de rede prende a transação até a rede
  responder — se a Meta ou o serviço de IA estiver lento, a transação trava e
  pode até dar timeout no meio de uma escrita legítima. Uma trigger que apenas
  insere uma linha em `event_log` é instantânea; quem faz a chamada de rede é
  um worker fora da transação, chamado periodicamente por cron, que pode
  falhar e tentar de novo sem nunca segurar um `INSERT` de ninguém.
- **Cloud API oficial da Meta, não WAHA/Evolution.** Soluções não-oficiais
  automatizam o WhatsApp normal (Web/Business app) e violam os termos de uso —
  o número pode ser banido sem aviso, o que é inaceitável para um produto que
  vai atender clientes de verdade. A Cloud API tem limite de taxa mais baixo e
  exige processo de aprovação, mas é a única opção que não desaparece do dia
  para a noite.
- **Sem Redis/BullMQ/Kafka.** Com uma equipe pequena e volume inicial baixo,
  uma tabela com `SELECT ... FOR UPDATE SKIP LOCKED` resolve fila com muito
  menos peça para operar. Se o volume um dia justificar throughput que o
  Postgres não aguenta, trocamos — mas começar com Kafka para um CRM de uma
  equipe pequena é complexidade que ninguém vai usar.

## 3. Isolamento multi-tenant (RLS)

Toda tabela com `org_id` tem uma função auxiliar central:

```sql
create or replace function public.fn_user_org_ids()
returns setof uuid
language sql stable security definer
set search_path = public
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and accepted_at is not null
$$;
```

E uma política por tabela no formato:

```sql
create policy tenant_isolation_select on public.<tabela>
  for select using (org_id in (select fn_user_org_ids()));
```

`security definer` é necessário porque a política de RLS de `org_members` não
pode consultar a si mesma sem entrar em recursão — a função roda com
privilégio elevado só para resolver "a quais organizações este usuário
pertence", e nada além disso.

A *service role key* (usada pelo worker e por rotas de admin) **ignora RLS por
completo** — é assim que o Postgres permite tarefas de manutenção. Por isso
toda rota ou worker que usa a service role precisa filtrar `org_id`
manualmente, a partir de uma fonte confiável (JWT decodificado, o próprio
`channels.phone_number_id` do webhook) — nunca de um campo que o cliente
mandou no corpo da requisição.

## 4. Fila e idempotência

- **Emissão:** ao inserir uma linha em `messages` (mensagem recebida), uma
  trigger insere uma linha correspondente em `event_log` com
  `status = 'pending'`. A trigger só faz `INSERT`, nunca `fetch`/HTTP.
- **Consumo:** um endpoint `/api/cron/drain-events`, chamado por Vercel Cron a
  cada minuto, seleciona um lote de `event_log` com
  `SELECT ... FOR UPDATE SKIP LOCKED`, processa cada evento e marca
  `done`/`failed`. Isso permite mais de uma invocação concorrente sem
  processar o mesmo evento duas vezes.
- **Idempotência de mensagem:** índice único em `messages (org_id, wamid)`
  (parcial, só quando `wamid is not null`). Se a Meta reentregar o mesmo
  webhook, o segundo `INSERT` falha com `23505` (violação de unicidade) e o
  worker trata isso como sucesso silencioso, não como erro.
- **Idempotência de evento:** `event_log.dedupe_key` é único; o worker calcula
  a chave a partir do `wamid`/tipo de evento antes de inserir, então mesmo a
  etapa de enfileiramento não duplica.

## 5. Auditoria

`audit_log` é populada pelo **código da aplicação**, não por trigger — cada
rota de servidor que faz uma mutação relevante (criar lead, mudar etapa,
enviar mensagem, alterar papel de membro) grava uma linha logo após a
mutação ter sucesso, com `actor_id`, ação, tipo/id do recurso e o valor antes
e depois. É "fire-and-forget": se a escrita de auditoria falhar, a mutação
principal não é desfeita, mas o erro vai para o log de observabilidade.
`audit_log` não tem `UPDATE`/`DELETE` liberado para nenhum papel — é
apêndice puro.

## 6. Autorização

Toda decisão de "quem pode fazer o quê" é validada no Route Handler, antes de
tocar no banco: papel do usuário na organização (`owner > admin > manager >
agent`) e RLS como segunda camada. Esconder um botão no React é UX, não é
controle de acesso.

## 7. Segredos e mídia

- Token de acesso da Meta por canal fica em `channels.access_token_encrypted`
  (`pgcrypto`, `pgp_sym_encrypt`), nunca em texto puro — mesmo estando só
  acessível via service role, criptografar em repouso limita o estrago se o
  banco vazar.
- Mídia recebida é baixada pelo worker (que tem o token da Meta) e salva no
  bucket privado do Supabase Storage; a tela nunca fala direto com a Graph
  API — só pede uma URL assinada de curta duração para o que já está no nosso
  Storage.

## 8. Decisões tomadas nesta fase (onde o briefing estava em aberto)

Ver seção "Decisões e pendências" na mensagem de entrega da Fase 0.
