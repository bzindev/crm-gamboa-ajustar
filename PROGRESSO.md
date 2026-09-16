# PROGRESSO

## 2026-09-15 — Fase 2 (canal Meta) — PAUSADA, retomar quando o número estiver livre

O número que será usado neste projeto está hoje conectado a outro CRM —
não dá para testar webhook/envio de verdade agora, e a Fase 2 só fecha
quando isso for possível ("mando mensagem do celular e ela aparece em
menos de 5s"). Decisão: pausar aqui, não terminar sem testar ao vivo.

**Já escrito e reaproveitável quando a Fase 2 voltar** (nada disso se
perde, só não está ligado em nenhuma tela ainda):
- `supabase/migrations/0006_fn_claim_pending_events.sql` — função
  `security definer` que reivindica lote de `event_log` com
  `FOR UPDATE SKIP LOCKED` (necessário porque o PostgREST não expõe lock de
  linha pela API REST).
- `lib/crypto/token-cipher.ts` — cifra AES-256-GCM em Node para o token do
  canal (decisão: não usar `pgp_sym_encrypt` do Postgres, que exigiria
  mandar a chave como parâmetro de query e arriscar vazar em log de
  statement).
- `lib/whatsapp/graph-client.ts`, `errors.ts`, `webhook-signature.ts`,
  `webhook-schema.ts` — cliente da Graph API, mapeamento de erro para PT-BR,
  validação HMAC do webhook, e o schema Zod (permissivo) do payload.
- `.env.local` já tem `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET` e
  `WHATSAPP_WEBHOOK_VERIFY_TOKEN` gerados. Falta só `WHATSAPP_APP_SECRET`
  (vem do painel do Meta for Developers) quando formos retomar.
- Migration `0006` ainda **não foi aplicada** no Supabase (nada no banco
  depende dela ainda).

**Pendente para retomar:** aplicar a `0006`, construir a tela de canal, o
webhook, o worker, o envio de texto e o inbox mínimo — tudo isso está
detalhado no plano que foi aprovado antes da pausa (pode ser refeito
rapidamente reaproveitando esses arquivos).

## 2026-09-15 — Fase 1 (fundação) — FECHADA ✅

**Gate obrigatório da fase, validado de verdade:**
`tests/rls-isolation.test.ts` passando contra o projeto Supabase real
(`crm-whatsapp-dev`): caso de controle prova que a organização B existe,
usuário real de A (JWT de verdade, via login) lê **zero** linhas de B e
lê a própria organização A normalmente.

**Fluxo manual completo testado no navegador, ponta a ponta:**
1. Cadastro (com confirmação de e-mail) → onboarding → criação da
   organização "Renault Gamboa" como `owner`.
2. Convite gerado em `/configuracoes/equipe`, link copiado, aceito por uma
   segunda conta (papel `agent`/Atendente).
3. RBAC confirmado nos dois sentidos: o menu não mostra "Equipe" para
   `agent`, **e** acessar `/configuracoes/equipe` direto pela URL como
   `agent` redireciona para `/dashboard` no servidor — não é só o link
   escondido na tela.

**Dois bugs reais encontrados e corrigidos durante o teste manual (é
exatamente para isso que o teste manual serve, além do automatizado):**
1. **Lista de Membros vinha vazia.** `org_members.user_id` referenciava
   `auth.users(id)`, não `public.profiles(id)` — sem uma foreign key direta
   entre as duas, o PostgREST não conseguia montar o
   `profiles(full_name)` embutido na consulta. Corrigido em
   `0004_org_members_fk_profiles.sql` (trocada a referência da constraint;
   seguro porque o trigger de `0002` sempre cria o profile antes de existir
   qualquer `org_members` daquele usuário).
2. **`fn_accept_invite` sempre falhava com `42702: column reference
   "org_id" is ambiguous`.** A função declarava
   `returns table (org_id uuid, org_name text)` — em PL/pgSQL isso vira
   variável dentro da função, e colidia com a coluna `org_id` usada em
   `on conflict (org_id, user_id)`. Corrigido em
   `0005_fix_ambiguidade_accept_invite.sql`, renomeando as colunas de saída
   para `result_org_id`/`result_org_name` (precisou `drop function` antes
   de recriar — `create or replace` não deixa mudar o retorno de uma
   função que já existe).

**Armadilha operacional (não é bug, mas trava teste):** o projeto Supabase
usa o e-mail de teste padrão dele (sem SMTP próprio), que tem um limite
baixo de envios por hora — vários cadastros seguidos batem no limite
("email rate limit exceeded"). Para continuar testando, desativamos
temporariamente **"Confirm email"** em Authentication → Providers → Email
no painel do Supabase.
**Antes de ir para produção: reativar a confirmação de e-mail** (ou
configurar um SMTP próprio) — deixá-la desligada permite cadastro com
e-mail inexistente/de terceiro.

Também melhoramos `lib/actions/auth.ts` e `lib/actions/invites.ts` para
logar o erro real do Supabase no servidor (`console.error`) em vez de só
devolver uma mensagem genérica — foi assim que os dois bugs acima foram
diagnosticados. Vale manter esse padrão daqui para frente.

## 2026-09-15 — Fase 1 (fundação) — histórico da implementação inicial

**Pronto:**
- Projeto Next.js 16 (App Router, TypeScript estrito, Tailwind v4,
  `npm`) escrito em cima dos artefatos da Fase 0.
- `shadcn/ui` inicializado (base Radix, preset Nova) com os componentes
  usados nas telas desta fase.
- Clients Supabase: `lib/supabase/server.ts` (SSR, cookies), `client.ts`
  (browser), `admin.ts` (service role, só para testes/worker futuro —
  nenhuma rota de aplicação usa a service role nesta fase, ver decisão
  abaixo).
- `proxy.ts` (renovação de sessão + redireciona não-autenticado para
  `/login`) — no Next.js 16 o arquivo que era `middleware.ts` virou
  `proxy.ts`; a função foi criada já com esse nome, não é uma migração
  posterior.
- `lib/auth/session.ts` e `require-role.ts`: resolução de organização ativa
  (cookie como dica de UX, sempre revalidado contra `org_members`) e gate
  de papel (`requireRole` para Server Actions, `requireRoleOrRedirect` para
  páginas).
- Migrations `0002` (tabela `org_invites` + trigger que cria `profiles` no
  cadastro) e `0003` (três funções `security definer`:
  `fn_create_organization`, `fn_get_invite_preview`, `fn_accept_invite`) —
  nenhuma das duas estava prevista no baseline da Fase 0. Ver o comentário
  no topo de `0003_fn_organizacoes_e_convites.sql` para o porquê de criar
  organização e aceitar convite exigirem função no banco em vez de INSERT
  direto sob RLS comum.
- Telas: `/login`, `/cadastro`, `/convite/[token]`, `/onboarding`,
  `/dashboard` (placeholder), `/configuracoes/equipe` (listar
  membros/convites, gerar link de convite — só admin/owner).
- `tests/rls-isolation.test.ts` (Vitest): gate de isolamento da Fase 1.
  Roda contra o projeto Supabase real; sem `.env.local` preenchido, a
  suíte é pulada (não falha) — confirmado rodando `npm run test` sem
  credenciais.
- `npm run typecheck`, `npm run lint` e `npm run build` (produção,
  Turbopack) verdes.

**Decisão que evoluiu durante a implementação (vs. o plano aprovado):**
Aceitar convite por token virou uma função `security definer`
(`fn_accept_invite`) chamada via `supabase.rpc(...)` com o client normal do
usuário, em vez de o código do servidor usar a service role para buscar o
convite pelo token. Funciona melhor: a regra "quem tem o token pode ver e
aceitar aquele convite" fica descrita uma vez só, no banco, e a service role
deixou de ser necessária em qualquer rota da aplicação nesta fase — só
`tests/rls-isolation.test.ts` a usa (para semear os dados de teste e provar
o caso de controle). Mesma lógica para criar a primeira organização
(`fn_create_organization`).

**Isso tudo foi resolvido depois** — ver a entrada no topo deste arquivo
("Fase 1 — FECHADA"): projeto Supabase `crm-whatsapp-dev` criado, as cinco
migrations aplicadas (`0001` a `0005`, as duas últimas corrigindo bugs
achados no teste manual), e o fluxo completo validado no navegador.

**Armadilhas encontradas nesta fase:**
- `create-next-app` sobrescreveu o `CLAUDE.md` da Fase 0 com o padrão dele
  (`@AGENTS.md`, um arquivo que o próprio `next dev` gera e regrava
  sozinho com notas de breaking changes da versão instalada). Conteúdo
  original restaurado, com a inclusão de `AGENTS.md` mantida no topo.
- `describe.skipIf` do Vitest não pula o corpo síncrono do `describe` — só
  os hooks (`beforeAll`/`afterAll`) e os `it`. Criar o client Supabase
  direto no corpo do `describe` (fora de um hook) derrubava a suíte inteira
  quando faltava `.env.local`, em vez de pular como esperado. Corrigido
  movendo a criação do client para dentro do `beforeAll`.
- `vitest@5` exige `@types/node` `^22`/`>=24`; o `create-next-app` instala
  `^20` por padrão. Atualizado para `^24` (compatível com o Node 24
  instalado na máquina).

## 2026-09-15 — Fase 0 (plano)

**Pronto:**
- `BRIEFING.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `PLANO.md`, `.env.example`
  criados.
- `supabase/migrations/0001_baseline.sql`: schema de `organizations`,
  `profiles`, `org_members`, `channels`, `contacts`, `consents`,
  `conversations`, `messages`, `webhook_deliveries`, `event_log`,
  `audit_log` — com RLS e função `fn_user_org_ids()`. Ainda não aplicado em
  nenhum projeto Supabase real (não existe projeto Supabase criado ainda).
- Pesquisa feita contra documentação atual da WhatsApp Cloud API (setembro
  de 2026): assinatura `X-Hub-Signature-256` (HMAC SHA-256 do corpo cru),
  handshake de verificação (`hub.challenge`), janela de 24h + templates,
  fluxo de mídia em duas etapas, versão vigente da Graph API é v23.0.

**Pendente:**
- Nome comercial do projeto e domínio de produção — ficaram como
  placeholder (`crm-whatsapp` / `SEU-DOMINIO.com.br`) em todos os arquivos.
  Trocar antes de ir para produção (procurar por essas strings nos arquivos
  da Fase 0).
- Nenhum código de aplicação existe ainda — Fase 1 começa do zero
  (`create-next-app`).
- Pré-requisitos de WhatsApp (conta Meta Business verificada, número
  dedicado, token permanente, túnel HTTPS) não provisionados — bloqueiam a
  Fase 2, não a Fase 1.

**Armadilhas encontradas:**
- O diretório do projeto já continha um backend Django (`clientes`, `leads`,
  `usuarios`, `veiculos`, `vendas`) e uma `venv/` Python — não relacionado a
  este projeto (stack incompatível com o briefing). Movido para
  `C:\Users\Bernardo\CRM-Empresa-Django-Antigo\` antes de começar, a pedido
  do usuário. Se algo daquele projeto era esperado aqui, verificar essa
  pasta.
- O repositório de referência (DeskcommCRM) usa WAHA Plus para WhatsApp, não
  a Cloud API oficial — os padrões de fila/RLS/auditoria foram espelhados,
  mas o webhook e a autenticação de canal foram desenhados do zero para o
  contrato da Meta (HMAC SHA-256, não SHA-512; `phone_number_id` em vez de
  sessão WAHA). Ver seção 8 da mensagem de entrega da Fase 0 para o
  detalhe completo dessa divergência.
