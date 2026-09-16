# CLAUDE.md — Convenções deste projeto

@AGENTS.md

Leia `BRIEFING.md` (fonte de verdade original) e `ARCHITECTURE.md` (o porquê
das decisões) antes de mexer em qualquer coisa aqui. Este arquivo é a versão
"convenção de código" das regras da seção 4 do briefing — se algo aqui
divergir do briefing, o briefing vence e é para avisar o usuário.

`AGENTS.md` (incluído acima) é gerado e mantido pelo próprio `next dev` —
tem notas específicas de breaking changes da versão do Next.js instalada.
Não editar à mão; ele se regenera sozinho.

## Stack (não trocar sem perguntar)

Next.js (App Router) + React + TypeScript estrito · Supabase (Postgres + Auth
+ Realtime + Storage) · Tailwind + shadcn/ui · Zod em toda entrada externa ·
Meta WhatsApp Cloud API (oficial, sem WAHA/Evolution) · fila via tabela
`event_log` drenada por cron · deploy Vercel + Supabase.

Sem Redis, sem BullMQ, sem microserviço, sem Kafka. Se parecer necessário,
parar e perguntar antes de introduzir.

## Regras não-negociáveis

1. **Toda tabela de organização tem `org_id uuid not null references
   organizations(id)` e RLS ativa**, sem exceção — nem tabela auxiliar, nem
   "por enquanto". Toda migration nova que cria tabela tenant-aware já nasce
   com `alter table ... enable row level security` e as políticas
   correspondentes na mesma migration.
2. **Autorização é sempre server-side.** Todo Route Handler valida papel
   (`owner/admin/manager/agent`) e organização ativa antes de tocar no banco.
   Esconder algo na UI não é controle de acesso.
3. **Nenhuma trigger de banco faz chamada HTTP.** Evento vira linha em
   `event_log`; um worker chamado por cron drena a fila.
4. **Toda mutação relevante grava uma linha em `audit_log`** (append-only —
   sem grant de `UPDATE`/`DELETE` para nenhum papel): quem, o quê, quando,
   valor antes e depois. Escrita fire-and-forget: falha na auditoria não
   desfaz a mutação principal, mas vai para o log de erro.
5. **Idempotência em tudo que vem de fora.** Webhook da Meta pode chegar
   duplicado — isso é esperado, não é bug. `messages` tem índice único parcial
   em `(org_id, wamid)`; `event_log` tem `dedupe_key` único.
6. **Nenhum segredo no cliente.** Token da Meta, service role key, app secret
   e chave de criptografia só existem em variáveis de ambiente do servidor.
   Nunca prefixar com `NEXT_PUBLIC_`.
7. **LGPD por padrão.** Anonimizar é preferível a deletar. Consentimento de
   contato é auditado em `consents`. Dado pessoal (CPF, telefone, e-mail)
   nunca vai para `console.log`/logger de erro em texto puro.
8. **Toda migration é idempotente e versionada** em
   `supabase/migrations/NNNN_slug.sql`, roda duas vezes sem quebrar
   (`if not exists`, `if exists`, `create or replace function`).

## `supabase-js`, não ORM direto

Runtime usa `supabase-js` com o client autenticado (`@supabase/ssr`), que
propaga o JWT do usuário — é isso que ativa a RLS automaticamente em cada
query. Nunca conectar direto no Postgres com Drizzle/Prisma no caminho de
runtime: isso usaria a credencial de serviço e atravessaria RLS em silêncio.
Rotas que legitimamente precisam da service role (worker, admin) filtram
`org_id` manualmente a partir de fonte confiável (JWT, `channels.
phone_number_id` do webhook) — nunca de campo enviado pelo cliente no corpo da
requisição.

Sempre use `getUser()` no servidor (valida o JWT contra o Supabase Auth),
nunca `getSession()` (confia no cookie local sem validar).

## Webhook do WhatsApp

- `GET /api/webhooks/whatsapp`: responde `hub.challenge` em texto puro só se
  `hub.verify_token` bater com `WHATSAPP_WEBHOOK_VERIFY_TOKEN`; senão, 403.
- `POST /api/webhooks/whatsapp`: lê o corpo **cru** (antes de qualquer parse
  JSON) para validar `X-Hub-Signature-256` (HMAC SHA-256 com
  `WHATSAPP_APP_SECRET`, comparação em tempo constante). Assinatura inválida
  → 401, sem processar nada.
- Sempre responde 200 em menos de 5s: grava em `webhook_deliveries`,
  enfileira em `event_log`, retorna. Processamento pesado (baixar mídia,
  atualizar `messages`) acontece no worker, fora da requisição do webhook.
- Resolve a organização pelo `metadata.phone_number_id` do payload contra
  `channels.phone_number_id`. Se não encontrar, registra em
  `webhook_deliveries` com `org_id null` e ignora — não derruba o webhook.

## Estilo de código

- TypeScript estrito, sem `any` não justificado.
- Nomes de tabela/coluna em `snake_case` (padrão Postgres); identificadores de
  TypeScript em `camelCase`; componente React em `PascalCase`.
- Zod valida toda entrada externa (body de API, webhook, `env`) antes de
  qualquer lógica de negócio tocar nela.
- Sem `console.log` esquecido em código mergeado — usar um logger estruturado
  que já sanitiza campos sensíveis (CPF, telefone, e-mail) antes de qualquer
  chamada de observabilidade externa.
- Sem abstração especulativa: três linhas parecidas não viram helper até que
  uma quarta apareça.

## Definição de pronto (antes de todo commit)

1. `typecheck` zero erro.
2. `lint` zero erro.
3. Testes da parte alterada passando (rodar, não assumir).
4. Se a mudança toca tabela tenant-aware: teste de isolamento (duas orgs,
   RLS) existe e passa.
5. Mutação relevante grava em `audit_log`.
6. Toda entrada externa nova validada por Zod.
7. Variável de ambiente nova documentada em `.env.example`.
8. `PROGRESSO.md` atualizado com o que ficou pronto/pendente/armadilhas.

## Commits

Português, formato `tipo(escopo): descrição` — ex.: `feat(inbox): mostra
janela de 24h na thread`, `fix(webhook): valida assinatura antes do parse`.
Commits pequenos, um assunto por commit.

## Hierarquia de autoridade

Este arquivo > `ARCHITECTURE.md` > `PLANO.md` > convenção implícita no código
existente. Se dois documentos conflitarem, `CLAUDE.md` decide — e isso mesmo é
motivo para avisar o usuário e corrigir o documento desatualizado.
