# PLANO — fases em tarefas

Uma fase por sessão, com contexto limpo entre elas. Não iniciar a próxima
antes do "pronto quando" da anterior estar de fato verde no terminal.

## Fase 0 — Plano ✅ (esta sessão)

- [x] Ler o briefing inteiro e o repositório de referência DeskcommCRM
      (`ARCHITECTURE.md`, `CLAUDE.md`, `supabase/baseline.sql`).
- [x] Confirmar contra a documentação atual da Meta: verificação de assinatura
      `X-Hub-Signature-256` (HMAC SHA-256, corpo cru), handshake de
      verificação do webhook (`hub.challenge`), janela de 24h e templates,
      fluxo de mídia em duas etapas (`GET /{media-id}` → URL temporária →
      download com header de autorização), versão vigente da Graph API
      (v23.0 em setembro de 2026).
- [x] Mover projeto Django pré-existente (`backend/`, `venv/`) para
      `C:\Users\Bernardo\CRM-Empresa-Django-Antigo\` — não fazia parte deste
      projeto e usava stack incompatível (Python/Django vs. Next.js/Supabase
      definido no briefing).
- [x] Produzir `ARCHITECTURE.md`, `CLAUDE.md`,
      `supabase/migrations/0001_baseline.sql`, `.env.example`, `PLANO.md`.

## Fase 1 — Fundação ✅ (fechada em 2026-09-15)

**Objetivo:** projeto rodando, login/cadastro, organização, convite, RBAC
aplicado no servidor, RLS ativa, shell de navegação.

Detalhe completo do que foi feito, decisões que mudaram no meio do caminho
e bugs encontrados no teste manual: ver `PROGRESSO.md`.

1. `npx create-next-app` (App Router, TypeScript estrito, Tailwind) +
   `shadcn/ui` init.
2. Projeto Supabase criado; `supabase/migrations/0001_baseline.sql` aplicado
   (`supabase db push` ou SQL editor).
3. `@supabase/ssr`: client de servidor (cookies HttpOnly, SameSite=Strict) e
   client de browser.
4. Tela de cadastro/login (e-mail+senha para começar; provedor social fica
   para depois, se pedido).
5. Fluxo de criação de organização: ao cadastrar, cria `organizations` +
   `org_members` (role `owner`) na mesma transação lógica.
6. Convite de membro: gera link/token, novo usuário aceita e vira
   `org_members` com `accepted_at` preenchido e o papel escolhido pelo
   convite.
7. Middleware/helper de servidor `requireRole(orgId, minRole)` usado em todo
   Route Handler que muda estado.
8. Shell da aplicação: navegação lateral, seletor de organização ativa
   (contexto salvo em cookie assinado pelo servidor, não em `localStorage`
   confiável para autorização).
9. **Teste de isolamento (gate obrigatório):**
   - cria organização A e organização B, cada uma com uma linha de teste
     (ex.: um `org_members` a mais, ou uma tabela simples);
   - **caso de controle:** com a service role, prova que a linha de B existe
     de verdade;
   - com o JWT de um usuário de A, prova que a query devolve **zero** linhas
     de B.
   - Sem o caso de controle, o teste passaria até com a tabela vazia — ele
     tem que existir explicitamente antes do teste de isolamento em si.

*Pronto quando:* o teste de isolamento acima passa, `typecheck`/`lint` zero
erro, dá para logar, criar organização, convidar um segundo usuário e ver a
navegação básica.

## Fase 2 — Canal Meta conectado

**Pré-requisito:** itens da seção "Pré-requisitos do mundo real" do briefing
provisionados (ver mensagem de entrega desta Fase 0) — sem eles, esta fase
não tem como ser testada de ponta a ponta.

1. Migration nova (`0002_channels_fase2_ajustes.sql` se algo faltar do
   baseline — o baseline já cobre `channels`, `contacts`, `conversations`,
   `messages`, `event_log`, `audit_log`, `webhook_deliveries`, `consents`).
2. Tela de cadastro de canal: formulário para `waba_id`, `phone_number_id`,
   token (criptografado antes de gravar em `access_token_encrypted` via
   `pgcrypto`).
3. Túnel HTTPS local (Cloudflare Tunnel/ngrok) documentado em
   `PROGRESSO.md` para o ciclo de desenvolvimento.
4. `GET /api/webhooks/whatsapp`: verificação de `hub.verify_token`.
5. `POST /api/webhooks/whatsapp`: leitura do corpo cru, validação HMAC
   SHA-256, gravação em `webhook_deliveries`, resolução de `org_id` via
   `channels.phone_number_id`, insert em `event_log`, resposta 200.
6. Endpoint `/api/cron/drain-events` (protegido por `CRON_SECRET`): processa
   lote de `event_log` com `SELECT ... FOR UPDATE SKIP LOCKED`, cria/atualiza
   `contacts` e `conversations`, insere `messages` (idempotente pelo
   `wamid`), marca `done`/`failed`.
7. Configurar Vercel Cron (ou equivalente) apontando para o endpoint acima.
8. Envio de texto simples: rota de servidor que chama
   `POST /{phone-number-id}/messages`, checando antes se a `conversation`
   está dentro da janela de 24h (`last_inbound_at`).
9. Mapeamento dos códigos de erro mais comuns da Meta para mensagem em
   português.

*Pronto quando:* mensagem mandada do celular aparece em `messages` em menos
de 5s; reenviar o mesmo payload de webhook manualmente não duplica linha
nenhuma; enviar um texto de volta pelo app chega no celular.

## Fase 3 — Inbox

1. Lista de conversas (Realtime em `conversations`/`messages` via
   `postgres_changes`), ordenada por `last_inbound_at`.
2. Thread de mensagens com scroll infinito por `created_at`.
3. Painel do contato (dados de `contacts`, histórico resumido).
4. Envio de mídia: upload para Storage (bucket privado) antes de mandar para
   a Graph API, ou download+persistência quando é mídia recebida.
5. Indicador de janela de 24h na UI (calculado a partir de
   `last_inbound_at`) que desabilita envio livre e sugere template quando
   fechada — e a API recusa o envio livre de qualquer forma, mesmo se a UI
   falhar.
6. Status de entrega/leitura refletido nos `status` de `messages` (via
   webhook de status, mesmo endpoint da Fase 2).
7. Atribuição de responsável (`conversations.assigned_to`).
8. Respostas rápidas (`quick_replies` — migration nova).

*Pronto quando:* dá para atender um cliente do início ao fim sem abrir o
banco.

## Fase 4 — CRM

1. Migrations novas: `pipelines`, `pipeline_stages`, `leads`, `tags`,
   `lead_tags`.
2. Vocabulário configurável por pipeline (`pipelines.vocabulary jsonb`:
   como cada organização chama "lead"/"ganho"/"perdido").
3. Kanban com arrastar (otimista na UI, confirmado no servidor com
   `position` fracionário para evitar reordenar tudo a cada move).
4. Visão 360 do contato dentro do inbox (histórico de leads + conversas).
5. Tags e filtro por tag na lista de conversas/leads.

## Fase 5 — Automação

1. Sincronização de `message_templates` pela API da Meta (migration nova).
2. Fontes de captação por webhook de entrada (endpoint genérico + Zod por
   fonte).
3. Regras QUANDO/SE/ENTÃO consumindo `event_log`.
4. Webhook de saída (notifica sistemas externos de eventos do CRM).

## Fase 6 — IA

Escopo definido só depois da Fase 5 em produção com cliente real.
