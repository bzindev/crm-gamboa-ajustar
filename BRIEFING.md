# BRIEFING — CRM de atendimento e vendas por WhatsApp

> Este arquivo é a fonte de verdade do projeto. Leia inteiro antes de escrever
> qualquer linha de código. Se algo aqui conflitar com uma instrução solta que eu
> der no chat, **pergunte** em vez de escolher sozinho.

---

## 1. O que vamos construir

Um CRM de atendimento e vendas onde toda a conversa com o cliente acontece pelo
WhatsApp, operado por uma equipe pequena. Multi-tenant desde o primeiro dia: uma
instalação atende várias organizações, e uma organização **nunca** enxerga dado
de outra.

O núcleo do produto é um *inbox* que recebe mensagens do WhatsApp em tempo real e
um *funil* onde cada conversa vira um negócio com etapa, responsável e histórico.
Tudo o mais (automações, IA, relatórios) é construído em cima disso e vem depois.

**Nome do projeto:** `crm-whatsapp` (placeholder — PREENCHER com o nome comercial)
**Domínio de produção:** `<PREENCHER>`

---

## 2. Referência de arquitetura

O projeto **DeskcommCRM** (github.com/melgarafael/DeskcommCRM, licença MIT)
resolve exatamente esse problema e a arquitetura dele é a que vamos espelhar.

- **Pode** ler o repositório para entender decisões: `ARCHITECTURE.md`,
  `CLAUDE.md`, `supabase/baseline.sql`, `docs/specs/`.
- **Não** copie código dele para cá. O objetivo é código próprio, entendido linha
  a linha. Copiar 3.000 commits de outra pessoa não é o que estamos fazendo.
- O que copiamos são os **padrões**: RLS em toda tabela tenant-aware, fila via
  tabela em vez de trigger fazendo HTTP, audit log append-only, vocabulário de
  funil configurável, teste de isolamento como gate obrigatório.

---

## 3. Stack — decidida, não negociável sem me perguntar

| Camada | Escolha |
|---|---|
| Framework | Next.js (App Router) + React + TypeScript em modo estrito |
| Banco | Supabase — Postgres com **RLS ligado em toda tabela** |
| Auth | Supabase Auth via `@supabase/ssr` (cookies HttpOnly, SameSite=Strict) |
| Tempo real | Supabase Realtime (`postgres_changes`) para o inbox |
| Arquivos | Supabase Storage, bucket **privado**, acesso só por URL assinada |
| Estilo | Tailwind + shadcn/ui |
| Validação | Zod em **toda** entrada externa: webhook, body de API, env |
| Fila | Tabela `event_log` + workers chamados por cron |
| WhatsApp | **Meta Cloud API oficial** (Graph API) — só ela, sem WAHA/Evolution |
| Deploy | Vercel + Supabase para começar |

**Sobre ORM:** as queries de runtime vão por `supabase-js`, não por Drizzle ou
Prisma. Motivo: `supabase-js` propaga o JWT do usuário, então a RLS do Postgres é
aplicada automaticamente em toda query. Um ORM conectando direto no Postgres usa
a credencial de serviço e **atravessa a RLS em silêncio** — é assim que vaza dado
de um cliente para outro sem ninguém perceber. O schema vive em arquivos `.sql`
versionados em `supabase/migrations/`.

**Sem Redis, sem BullMQ, sem microserviço, sem Kafka.** Se em algum momento você
achar que precisa de um deles, pare e me explique o porquê antes.

---

## 4. Regras não-negociáveis

Estas valem para todo código deste repositório. Violar qualquer uma é motivo de
refazer a tarefa.

1. **Toda tabela que pertence a uma organização tem `org_id` e RLS ativa.** Sem
   exceção, nem em tabela auxiliar, nem "por enquanto".
2. **Autorização é server-side.** Esconder um botão no React não é permissão.
   Todo route handler valida papel e escopo antes de tocar no banco.
3. **Nenhuma trigger de banco faz chamada HTTP.** Evento vira linha em
   `event_log`; um worker drena a fila.
4. **Toda mutação relevante grava em `audit_log`** (append-only, sem update, sem
   delete): quem, o quê, quando, valor antes e depois.
5. **Idempotência em tudo que vem de fora.** A Meta reenvia webhook. Processar a
   mesma mensagem duas vezes não pode criar dois registros.
6. **Segredo nenhum no cliente.** Token da Meta, service role key e app secret
   só existem no servidor. Nada de `NEXT_PUBLIC_` neles.
7. **LGPD:** anonimizar é preferível a deletar. Consentimento auditado. Dado
   pessoal (CPF, telefone, e-mail) nunca vai para log de erro.
8. **Migration é versionada e roda duas vezes sem quebrar.** Idempotente sempre.

---

## 5. Modelo de dados mínimo

Não é para implementar tudo agora — é o mapa. Cada tabela nasce na fase que
precisa dela.

**Organização e pessoas**
`organizations` · `org_members` (papel: `owner`, `admin`, `manager`, `agent`) ·
`profiles` (ligado a `auth.users`)

**Canal**
`channels` (um por número: `waba_id`, `phone_number_id`, referência ao token,
status de saúde) · `message_templates` (sincronizados da Meta, com status de
aprovação)

**Atendimento**
`contacts` (telefone E.164 único por org) · `conversations` (contato + canal +
status + responsável + `last_inbound_at`) · `messages` (`wamid` único, direção,
tipo, conteúdo, status, `media_path`) · `quick_replies`

**CRM**
`pipelines` · `pipeline_stages` (com vocabulário configurável: "lead" pode ser
*Cliente*, *Paciente* ou *Comprador*) · `leads` · `tags` · `lead_tags`

**Infra**
`event_log` (fila) · `audit_log` · `webhook_deliveries` (payload cru recebido da
Meta, para depuração e idempotência) · `consents`

---

## 6. WhatsApp Cloud API — o contrato

Esta é a parte onde projeto de WhatsApp costuma morrer. Trate cada item como
requisito, não como sugestão. **Confirme os detalhes contra a documentação atual
da Meta antes de implementar** — a API muda, e o que está escrito aqui é o
formato geral, não uma citação fiel da versão de hoje.

### Recebimento (webhook)

- **`GET /api/webhooks/whatsapp`** — verificação. A Meta manda `hub.mode`,
  `hub.verify_token` e `hub.challenge`. Se o token bater com o seu, responda o
  `hub.challenge` em texto puro. Se não bater, 403.
- **`POST /api/webhooks/whatsapp`** — recebimento. Antes de olhar o conteúdo,
  valide o header `X-Hub-Signature-256`: é um HMAC SHA-256 do **corpo cru** com o
  App Secret. Payload sem assinatura válida é descartado com 401. Isso exige ler
  o body como texto antes de qualquer parse — no App Router, cuidado para não
  consumir o stream duas vezes.
- **Responda 200 em menos de 5 segundos, sempre.** Grave o payload em
  `webhook_deliveries`, enfileire em `event_log`, devolva 200. Todo o
  processamento é assíncrono. Se você demorar ou der erro, a Meta reenvia, e
  reenvio acumulado vira canal suspenso.
- **Idempotência pelo `wamid`.** Índice único. Reentrega é normal, não é bug.
- **Um webhook, vários tenants.** O payload traz `metadata.phone_number_id` —
  é por ele que você descobre a qual organização aquela mensagem pertence. Se o
  `phone_number_id` não estiver cadastrado em `channels`, registre e ignore.
- O mesmo endpoint recebe **status de mensagem** (`sent`, `delivered`, `read`,
  `failed`) e eventos de conta. Trate cada tipo; não assuma que todo POST é
  mensagem nova.

### Envio

- Endpoint `POST /{phone-number-id}/messages` na Graph API.
- **Janela de 24 horas:** depois de uma mensagem do cliente, você tem 24h para
  responder com texto livre. Fora dessa janela, **só template aprovado**. Essa
  regra precisa estar no backend, não só na interface: o inbox deve mostrar a
  janela fechada e bloquear o envio livre, e a API deve recusar de qualquer jeito.
- Guarde `last_inbound_at` na conversa e calcule a janela a partir dele.
- Erros da Meta têm código próprio (fora de janela, número inválido,
  destinatário não alcançável). Mapeie os principais para mensagem em português
  na tela — "erro 400" não ajuda ninguém.
- Rate limit existe por número e por conta. Envio em massa precisa de fila com
  ritmo, nunca um `Promise.all` em cima de mil contatos.

### Mídia

- Mensagem com imagem, áudio, documento ou vídeo chega com um **`media_id`**, não
  com a URL. São duas chamadas: `GET /{media-id}` devolve uma URL temporária, e
  baixar essa URL exige o header de autorização. O link expira.
- Baixe no worker, salve no bucket privado do Storage, guarde o caminho em
  `messages.media_path`. Na tela, sirva por URL assinada de curta duração.
- Áudio do WhatsApp vem em `.ogg` (codec opus). Isso importa na hora de tocar no
  navegador e, mais tarde, de transcrever.

### Templates

- Templates são criados e aprovados do lado da Meta (categorias *marketing*,
  *utility*, *authentication*) e a aprovação leva de minutos a dias.
- Sincronize a lista e o status de aprovação pela API — não deixe o usuário
  digitar o nome do template na mão e descobrir o erro no envio.
- Template tem parâmetros posicionais. A tela precisa pedir cada variável e
  mostrar a prévia preenchida antes de enviar.

### Conformidade

- **Opt-in é obrigatório** para iniciar conversa. Registre em `consents` a origem
  e a data.
- **Detecte pedido de saída** ("PARE", "SAIR", "STOP") e marque o contato como
  descadastrado. Continuar mandando depois disso é denúncia certa e canal
  suspenso.

### Pré-requisitos do mundo real (providencie antes da Fase 2)

Nada disso é código, e tudo isso trava o projeto se ficar para depois:

1. Conta no **Meta Business Suite** com **verificação de negócio** — pode levar
   dias e pede documento do CNPJ.
2. App no **Meta for Developers** com o produto WhatsApp adicionado.
3. Um **número de telefone que não esteja registrado** no app WhatsApp nem no
   WhatsApp Business comum. Se estiver, precisa ser desvinculado antes, e isso é
   irreversível para aquele número.
4. **Token permanente** gerado por *System User* no Business Manager. O token que
   aparece no painel do app expira em 24 horas e não serve para produção.
5. **HTTPS público** para o webhook. Em desenvolvimento, túnel (Cloudflare Tunnel
   ou ngrok) — `localhost` a Meta não alcança.
6. O número de teste gratuito da Meta só envia para até 5 destinatários
   cadastrados. Serve para a Fase 2, não para demo com cliente.

---

## 7. Fases

Uma fase por vez. Não comece a próxima sem a anterior fechada.

**Fase 0 — Plano (nenhum código de aplicação)**
Produzir: `ARCHITECTURE.md` (uma página), `CLAUDE.md` (as regras da seção 4 em
formato de convenção), `supabase/migrations/0001_baseline.sql` com o schema das
tabelas das Fases 1 e 2, `.env.example` comentado e `PLANO.md` com as fases
detalhadas em tarefas. Ao final, me apresente as decisões que você tomou e onde
divergiu deste briefing.

**Fase 1 — Fundação**
Projeto Next.js rodando, login e cadastro, criação de organização, convite de
membro, RBAC de 4 papéis aplicado no servidor, RLS ativa, shell da aplicação com
navegação.
*Pronto quando:* existe um teste automatizado que cria duas organizações, simula
o JWT de um usuário da org A e prova que ele lê **zero** linhas da org B — com um
caso de controle antes provando que as linhas da org B existem de verdade. Sem
esse controle, o teste passaria com tabela vazia.

**Fase 2 — Canal Meta conectado**
Cadastro do canal na tela, webhook verificado e validando assinatura, mensagem
recebida virando linha em `messages`, worker drenando `event_log`, envio de texto
simples funcionando.
*Pronto quando:* mando uma mensagem do meu celular e ela aparece no banco em
menos de 5 segundos; reenviar o mesmo payload não duplica nada.

**Fase 3 — Inbox**
Lista de conversas, thread, painel do contato. Realtime. Envio de texto e mídia.
Janela de 24h visível e aplicada. Status de entrega e leitura. Atribuição de
responsável. Respostas rápidas.
*Pronto quando:* dá para atender um cliente de ponta a ponta sem abrir o banco.

**Fase 4 — CRM**
Contatos, funis com etapas e vocabulário configurável, kanban com arrastar,
leads, tags, visão 360 do cliente dentro do inbox.

**Fase 5 — Automação**
Templates sincronizados, fontes de captação por webhook de entrada, regras
QUANDO/SE/ENTÃO em cima do `event_log`, webhook de saída.

**Fase 6 — IA**
Só depois de tudo acima estar em produção com cliente real usando. Definimos o
escopo quando chegarmos lá.

---

## 8. Como trabalhar comigo

- **Uma fase por sessão.** Contexto limpo entre elas.
- **Plano antes de código.** Em tarefa não trivial, me mostre o plano e espere o
  ok. Se a tarefa tem mais de um caminho razoável, pergunte em vez de escolher.
- **Commits pequenos e descritivos**, em português, no formato
  `feat(inbox): ...` / `fix(webhook): ...`.
- **Antes de todo commit:** `typecheck` zero erro, `lint` zero erro, testes da
  parte que você mexeu passando. Não commite verde na sua cabeça, verde no
  terminal.
- **Mantenha `PROGRESSO.md`** com o que ficou pronto, o que ficou pendente e as
  armadilhas encontradas. É o que a próxima sessão vai ler.
- **Me explique o que você fez.** Eu estou aprendendo a programar construindo
  isto. Código que eu não entendo é dívida, não entrega. Quando usar um conceito
  novo (RLS, HMAC, fila, índice único), explique em duas frases o que ele faz e
  por que está ali.
- **Se eu pedir algo que contradiz este arquivo, me avise.** Eu posso ter mudado
  de ideia, ou posso ter esquecido o motivo da regra.

---

## 9. Comece agora pela Fase 0

Não escreva código de aplicação nesta sessão. Leia este briefing, consulte a
documentação atual da WhatsApp Cloud API para confirmar os pontos da seção 6,
produza os artefatos da Fase 0 e termine me apresentando:

1. as decisões que você tomou e que este briefing deixou em aberto;
2. os pontos onde você acha que este briefing está errado ou incompleto;
3. o que eu preciso providenciar (contas, números, chaves) antes da Fase 2.
