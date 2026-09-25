# PROGRESSO

## 2026-09-25 (continuação 2) — Duplicidade de contatos: reforço (tarefa 17)

Sem migration. A trava em si já existia (`unique(org_id, phone_e164)` desde
o baseline, e-mail case-insensitive desde 0014), mas tinha buraco:

**Bug corrigido**: o contato criado junto com um lead (Funil) não validava
o telefone — gravava do jeito que foi digitado. "11 99999-9999" entrava
cru, a trava de duplicidade não reconhecia como o mesmo "+5511999999999" (o
índice compara texto exato) e o contato nunca casava com a conversa do
WhatsApp. Verifiquei o banco: nenhum dos 634 contatos atuais foi afetado.

**Normalização no cadastro manual**: `normalizeContactPhone`
(`lib/crm/phone-normalize.ts`) — mesma regra brasileira da importação,
mas aceita número estrangeiro quando digitado com "+" de outro país.
Aplicada via `phoneField` (`lib/validation/contacts.ts`) no cadastro/edição
de contato e no contato novo do lead. A importação continua só com a regra
brasileira (decisão fechada pelo usuário).

**Aviso amigável**: quando o banco recusa por duplicidade, agora a tela
diz QUEM já existe ("Já existe um contato com esse telefone: João Silva.")
e o formulário de contato mostra um link "Abrir contato existente"
(`lib/crm/contact-duplicates.ts` — só roda depois da recusa do banco,
escopado por org). A trava continua sendo o índice único, não essa busca.

Testes: `tests/phone-normalize.test.ts`.

## 2026-09-25 (continuação) — Dashboard em tempo real (tarefa 28) + ranking de vendedores (tarefa 29)

Sem migration — tudo com dado que já existia.

**Tempo real**: `app/(app)/dashboard/realtime-listener.tsx` assina `leads`,
`conversations` e `messages` (todas já na publicação desde 0012/0016).
Diferente dos outros listeners, tem debounce de 2s: o dashboard refaz
várias consultas por render, então uma rajada de mensagens vira UM refresh.

**Ranking de vendedores** (card novo no dashboard, respeita o filtro "Este
mês"/"Total"): por vendedor — conversas em que respondeu, mensagens
enviadas, tempo médio de resposta, ganhos, conversão e valor ganho;
ordenado por ganhos. Mais o tempo médio de resposta da equipe toda. Lógica
em função pura (`lib/reports/vendor-ranking.ts`, testada em
`tests/vendor-ranking.test.ts`); busca de mensagens paginada
(`vendor-ranking-data.ts`) porque o Supabase corta SELECT em 1000 linhas
sem avisar. Template de disparo em massa (sem `sent_by`) não conta como
resposta de ninguém. Quem não teve atividade no período fica fora.

**Bug corrigido de carona**: o card "Contatos cadastrados" sempre mostrava
0 — a consulta usava `head: true` (só contagem) mas lia `data.length`.

**Decisão sem confirmar**: o ranking aparece pra todos os papéis, igual ao
"Leads por responsável" que já existia no dashboard. Se vendedor não deve
ver o desempenho dos colegas, dá pra restringir a gestor+.

**Limitação conhecida**: `lib/reports/response-time.ts` (tempo médio na
página de Relatórios) ainda usa `.limit(2000)`, que na prática o Supabase
corta em 1000 — pode subestimar em períodos com muita mensagem. Não mexi
por estar fora do escopo destas tarefas.

## 2026-09-25 — Follow-up automático (tarefa 26) + transferência de conversa (tarefa 22)

Migration `0020`. Duas tarefas da lista de pendências que não dependem do
WhatsApp estar conectado (rodaram só com dado que já existe no banco).

**Follow-up automático**: o indicador "lead parado" já existia como aviso
visual (`stage_alert_days`, configurável em Automações desde a Fase 4) —
só pintava o card no Kanban/Dashboard, não avisava ninguém de fato. Agora
`fn_stage_alert_breaches()` (mesmo padrão de `fn_sla_breaches`, 0018 —
marca como notificado atomicamente) roda no cron de 1 em 1 minuto e manda
notificação pro responsável do lead quando ele estoura o prazo sem mudar
de etapa. Só uma notificação por período parado (não fica repetindo todo
dia) — se quiser lembrete recorrente enquanto continuar parado, isso muda.
Só considera lead com dono individual e em aberto (`status = 'open'`);
sem dono, não tem pra quem lembrar.

**Transferência de conversa**: distinto de "assumir" (que só pega algo
livre, ou — sendo gestor — toma de volta uma já atribuída). Agora dá pra
escolher um colega específico e repassar a própria conversa direto, com
um botão "Transferir" ao lado do status na tela do Inbox. Vendedor comum
só repassa a própria conversa; gestor/admin repassa qualquer uma. Reseta
`assigned_at` (novo período de primeiro atendimento pro destinatário,
mesma régua da reatribuição automática da 0019). Notifica quem recebeu
(reaproveitando "lead atribuído a você") e quem perdeu, exceto quando foi
a própria pessoa que decidiu repassar.

Aplicada e verificada no banco. Revisão de segurança rodada, sem achado de
alta confiança.

## 2026-09-24 (continuação 2) — Reatribuição automática por falta de 1ª resposta

Migration `0019`. Regra nova no rodízio, diferente do alerta de SLA (0018):
se o vendedor responsável não manda NENHUMA mensagem dentro de um prazo
configurável (padrão 5 min) depois que a conversa passou a ser dele, ela é
tirada dele de verdade e passa pro próximo vendedor disponível no rodízio —
não é só um alerta, muda `conversations.assigned_to`. O ciclo se repete sem
limite até alguém responder ou ninguém mais estar disponível (aí a conversa
fica sem dono, igual já acontecia fora do horário de expediente).

**Coluna nova**: `conversations.assigned_at` — quando a conversa passou a
ter ESSE responsável (rodízio, "assumir conversa" ou responder uma conversa
livre). Diferente de `last_inbound_at`/`last_outbound_at`, que só falam de
troca de mensagem. Sem `assigned_at` (conversa nunca teve responsável
individual — ex.: ainda com o setor Recepção inteiro, ninguém assumiu),
não existe timer, exatamente como pedido. **Sem backfill** pras conversas já
atribuídas antes desta migration — ficam de fora da regra até a próxima
atribuição de verdade, pra não reatribuir em massa tudo que já estava em
andamento no momento em que rodou.

**`fn_response_breaches()`** (banco, SECURITY DEFINER, só `service_role`):
só lê candidatos — diferente de `fn_sla_breaches` (0018), não precisa marcar
"já notificado" porque a própria reatribuição (que reseta `assigned_at`)
já impede o mesmo estouro no minuto seguinte. `lib/whatsapp/
reassignment-check.ts` (worker, mesmo cron de 1 em 1 minuto de sempre) faz
o UPDATE com guarda otimista (`where assigned_to/assigned_at antigos`) pra
não reatribuir duas vezes se o cron sobrepuser, reaproveita
`tryAutoAssignFromRotation` (mesma função da distribuição inicial — já
filtra por presença online e horário de expediente) e usa o "rodízio geral"
como fallback quando a conversa não tem setor com rodízio próprio (caso de
algo herdado da Recepção).

**Notificações**: vendedor novo recebe a mesma notificação de "lead
atribuído" já existente; vendedor anterior recebe uma nova
(`conversation.reassigned_away`) avisando que perdeu por falta de resposta.

**Configurações**: nova aba **"SLA e Rodízio"** (`/configuracoes/
sla-rodizio`), admin/owner só — mesmo padrão de redirect de `/configuracoes/
geral` (o link da aba aparece pra todo mundo, mas a página redireciona
quem não é admin; é o mesmo comportamento que "Geral" já tinha, não um
padrão novo). O card de SLA que estava em "Geral" foi movido pra cá, ao
lado do novo campo de reatribuição — ambos os prazos configuráveis, valendo
a partir do próximo minuto do cron sem precisar reiniciar nada.

**Decisão tomada sem confirmar com o usuário**: interpretei "lead" no
pedido como sinônimo de "conversa atribuída a um vendedor" (não a entidade
`leads` do funil/CRM) — a justificativa é que a regra fala em "assumir
conversa", "setor Recepção" e "mensagem do vendedor conta como resposta",
que são todos conceitos de `conversations`/`messages`, não existem
equivalentes em `leads`. Se a intenção real era sobre o funil (cartão de
lead, não a conversa de WhatsApp), isso precisa ser refeito.

Aplicada e verificada no banco (colunas + função existem). Revisão de
segurança rodada, sem achado de alta confiança (só uma nota de correção,
não de segurança: numa sobreposição do cron, a execução que perde a corrida
otimista ainda consome um "turno" do rodízio antes de descartar a escrita —
não duplica reatribuição nem notificação, só pode fazer o próximo vendedor
escolhido pular uma posição a mais que o normal numa janela rara).

## 2026-09-24 (continuação) — Notificações push (Notification API) + contador de não lidas

Migration `0018`. Cobre os 3 gatilhos pedidos, todos passando pela MESMA
tabela `notifications` que já existia (0012) pro sino do topbar — só
faltava ela entrar na publicação do Realtime (esquecido em 0012, só
`messages`/`conversations` tinham entrado). Com isso, um único listener no
cliente (`components/notifications/notifications-provider.tsx`, montado
por `app/(app)/layout.tsx`) cobre lead atribuído, mensagem nova e SLA
estourado sem precisar de uma assinatura por gatilho.

**Lead atribuído** (`lib/actions/leads.ts`): notificação agora traz nome
do contato + origem e abre a conversa direto (procura uma `conversations`
já existente com aquele contato; sem uma, cai pro `/funil`, porque não tem
o que abrir). Sem dono (contato manual, sem rodízio ou fora do horário),
notifica o setor **"Recepção"** em vez de ninguém — setor novo, criado
por esta migration (backfill nas orgs existentes + `fn_create_organization`
pra orgs novas). **Decisão registrada, não confirmada com o usuário**: o
setor não existia antes; se não for o nome/conceito certo, é só renomear
ou mover gente nele pela tela de Setores — não tem nada hardcoded no
código além do nome usado pra achar o time.

**Mensagem nova**: já existia (`lib/whatsapp/process-events.ts`,
`notifyOne`) — só passou a chegar em tempo real por causa do fix na
publicação, nada mudou na lógica de quem é notificado.

**SLA estourado**: `organizations.sla_minutes` (default 15, configurável
em `/configuracoes/geral`, admin só). `fn_sla_breaches()` (função no
banco, SECURITY DEFINER, só `service_role` — mesmo padrão de
`fn_claim_pending_events`) acha conversas sem resposta há mais que o
limite e já marca como notificada atomicamente (evita duplicar se o cron
sobrepuser). Chamada pelo MESMO cron de 1 em 1 minuto que já drena o
`event_log` (`/api/cron/process-events`) — não ganhou cron próprio pra não
esbarrar em limite de quantidade de crons do Vercel. Notifica o vendedor
responsável E todo `manager`/`admin`/`owner` da organização.

**Contador de não lidas no título da aba** (`"(3) CRM"`): novas colunas
`conversations.last_read_at`/`sla_notified_at`. Marcado como lido quando o
vendedor responsável abre a conversa ou volta o foco pra aba
(`active-conversation-tracker.tsx`) — só grava se quem chamou for
`assigned_to`, então um gestor só acompanhando não zera a notificação de
quem ainda não respondeu. Comparação `last_read_at < last_inbound_at` é
coluna-com-coluna, não dá pra empurrar pro filtro do supabase-js — como a
lista de conversas de UM vendedor é pequena, filtra em JS depois de buscar
em vez de criar uma função no banco só pra isso.

**Suprime notificação nativa redundante**: se a conversa do link já está
aberta E a aba está em foco (`document.hasFocus()`), não dispara
`Notification` — só teria efeito pra lead/SLA sem link de conversa
específico, que sempre disparam.

**Permissão do navegador**: pedida uma vez só (`localStorage`), no
primeiro carregamento em que `Notification.permission === "default"` —
nunca de novo, nem se a pessoa recusar (é permissão de navegador, por
origem, não por conta — pedir nunca de novo depois de recusado não muda
nada mesmo).

**Pendente, fora do meu alcance de execução**: a migration `0018` ainda
não rodou no banco — sem CLI logada no Supabase neste ambiente, precisa
ser aplicada manualmente pelo SQL Editor do Supabase, igual às anteriores
(0016/0017). Sem isso, nada deste bloco funciona (colunas/função/tabela
na publicação não existem ainda).

## 2026-09-24 — Fase 4 fechada: realtime em Kanban/Funil + horário de expediente

Último bloco do plano de 4 fases. Migration `0016` (realtime) + `0017`
(horário de expediente).

**Realtime no Funil e no Kanban do Inbox:** `app/(app)/funil/
realtime-listener.tsx` (novo, mesmo padrão do Inbox) assina `leads` e
`pipeline_stages`. Ao investigar isso, achei um bug real que já existia
nos dois kanbans (Funil e o do Inbox construído na Fase 3): o estado local
do board (`useState(() => groupByStage(...))`) só era montado uma vez e
NUNCA mais sincronizava com dados novos vindos do servidor — funcionava
por acidente porque cada drag já mexia no próprio estado local, mas
mudança feita por outra pessoa nunca aparecia, com ou sem realtime.
Corrigido nos dois (`kanban-board.tsx` e `conversation-kanban.tsx`) com um
`useEffect` que resincroniza a partir das props, pausado por um `ref`
enquanto um drag está em andamento (pra não competir com o estado
otimista de quem está arrastando um card bem naquela hora).

**Horário de expediente** (`/configuracoes/geral`, admin só):
`organizations.business_hours` (segunda a sexta + sábado opcional,
domingo sempre fechado). `lib/crm/business-hours.ts` calcula em
America/Sao_Paulo fixo (não configurável ainda) — importante porque o
servidor roda em UTC na Vercel, `new Date().getHours()` direto daria
horário errado em produção.

Usado de verdade, não só guardado: `tryAutoAssignFromRotation`
(`lib/crm/rotation.ts`) agora também checa o horário antes de distribuir
— lead ou conversa que chegar fora do expediente fica sem dono, igual já
acontecia quando ninguém estava online, em vez de "acordar" um vendedor de
madrugada. **Não constrói** a fila de redistribuição automática quando o
expediente reabre (item que ficou registrado como pendente lá na Fase 1)
— isso exigiria um cron novo revisitando leads/conversas sem dono
periodicamente; fica pra quando for pedido.

**Com isso, as 4 fases do plano de distribuição estão fechadas.**
Pendências que ficaram registradas ao longo do caminho, nenhuma delas
pedida de volta ainda:
- Agendamento de visitas (Fase 3, item 10) — fora de escopo por pedido do
  usuário.
- Fila de redistribuição quando o expediente reabre (mencionado acima).
- Balanceamento por carga no rodízio (só round robin puro por enquanto).
- Regras de distribuição por origem/campanha (só por rodízio + horário).
- Auditoria completa de permissões tela-por-tela (só a regra de dono de
  conversa foi revisada, não uma varredura formal de todas as telas).
- Toggle de UI para ligar rodízio automático nos outros setores (Peças,
  Pós-Vendas) — hoje só via SQL direto.

## 2026-09-23 (continuação 3) — Fase 3 quase fechada: kanban do Inbox, relatório de contatos, import/export

Item 10 (agendamento de visitas) segue fora de escopo por pedido do
usuário ("esse app não mexe agora"). Os outros três itens da Fase 3:

**Kanban do Inbox por status** (combinado antes de construir o Monitor,
só agora implementado): `/inbox` ganhou um toggle Lista/Kanban
(`inbox-shell.tsx`). Kanban mostra 4 colunas fixas (Aberta/Pendente/
Resolvida/Fechada), arrastar um card entre colunas chama
`updateConversationStatus` (a mesma Server Action que o seletor de status
já usava). Mais simples que o Kanban do Funil — conversa não tem
`position` pra ordenar dentro da coluna, só a coluna importa. Clicar num
card leva pra `/inbox/:id` de sempre.

**Relatório de contatos** (`/relatorios/contatos`, nova aba ao lado de
"Geral"): diferente do relatório de leads (que é por período), aqui a
tabela é a base inteira de contatos — período só afeta a métrica "novos no
período". Cards de resumo: total, novos, com opt-in, sem nenhum lead.
Extraído `lib/reports/csv.ts` (a função `csvEscape` com proteção contra
CSV injection, que antes só existia dentro de `leads-report.ts`) pra não
duplicar a mesma lógica de segurança em dois lugares.

**Relatório geral ganhou "tempo médio de resposta"**: não existia coluna
pronta pra isso — `lib/reports/response-time.ts` varre as mensagens do
período em ordem e mede o tempo entre a mensagem do cliente e a primeira
resposta do vendedor depois dela, por conversa, e tira a média.

**Exportar/importar contatos** (`/contatos`): exportar já existia como
padrão (CSV, mesmo `csvEscape`); importar é novo —
`lib/actions/contacts-import.ts` lê um CSV (parser próprio em
`lib/reports/csv-parse.ts`, sem biblioteca nova, mesmo raciocínio das
exportações anteriores), casa colunas por nome de cabeçalho
(nome/telefone/e-mail), atualiza quem já existe pelo telefone e cria quem
não existe. **Decisão deliberada de LGPD:** importação nunca marca
opt-in — mesmo que a planilha tenha uma coluna assim, consentimento de
marketing não se herda de uma importação em massa, só de uma ação
explícita por contato (`lib/crm/consent.ts`). Ação restrita a manager+
(diferente de criar um contato avulso, que continua aberto a qualquer
membro) — importação em massa erra em mais gente de uma vez se o arquivo
estiver errado.

**Pendente:**
- Agendamento de visitas (item 10) — fora de escopo por enquanto.
- Fase 4 (realtime em Kanban/Funil, configurações gerais ampliadas) ainda
  não começou.
- Import de contatos só aceita CSV, não .xlsx — mesma decisão de não
  adicionar biblioteca nova já tomada pra exportação.

## 2026-09-23 (continuação 2) — Fase 2 fechada: disparo em massa + templates

Último item da Fase 2. Usuário confirmou que ainda não tem template
aprovado no Meta Business Manager, então entrou no escopo uma tela de
gestão de templates, não só o disparo em si.

**Migration `0015`**: `message_templates` (espelha nome/idioma/categoria/
corpo/status do template no Meta), `bulk_campaigns` (nome, template usado,
contadores de enviado/falhado) e `bulk_campaign_recipients` (status por
contato — pending/sent/failed/skipped_no_consent).

**`/disparos/templates`** (admin só — mesma sensibilidade de conectar
canal, é vinculado ao WABA da organização): criar template chama
`POST /{waba-id}/message_templates` na Graph API e grava o retorno; botão
"atualizar status" consulta a aprovação (que acontece do lado da Meta, de
minutos a dias, fora do nosso controle). v1 só suporta 0 ou 1 variável no
corpo, sempre preenchida com o nome do contato — sem header/footer/botão
dinâmico ainda.

**`/disparos` e `/disparos/novo`** (manager+): lista de campanhas e
formulário de criação — nome, template (só os já aprovados aparecem),
lista de contatos com busca e "selecionar todos com opt-in". Cada
destinatário vira uma linha em `bulk_campaign_recipients` e um evento
`whatsapp_bulk_message` no `event_log` — o mesmo worker que já drena a
fila do webhook (`lib/whatsapp/process-events.ts`) processa em lote,
sem precisar de nenhuma infra de fila nova.

**Consentimento é checado na hora de montar a campanha**, usando a tabela
`consents` (LGPD) como pedido — contato sem consentimento ativo vira
`skipped_no_consent` automaticamente, mesmo que selecionado no formulário.
Como nada nunca escrevia em `consents` antes (só existia o schema),
`contacts.opted_in` virou de fato funcional: o checkbox no formulário de
contato agora grava/revoga uma linha em `consents` por trás
(`lib/crm/consent.ts`) — antes disso a campanha nunca teria ninguém
elegível pra receber nada.

Envio usa `sendTemplateMessage` (novo em `lib/whatsapp/graph-client.ts`) e
cai na mesma `conversations`/`messages` do chat normal — cria a conversa
se ainda não existir, então a resposta do cliente já cai num lugar
conhecido. Erro de envio marca só aquele destinatário como falho
(mensagem da Meta traduzida) em vez de derrubar o lote inteiro ou ficar
retentando a mesma falha permanente 5 vezes.

**Pendente:**
- Ainda não testado com template de verdade aprovado (depende da Meta
  aprovar um).
- Sem paginação na lista de contatos do formulário de campanha — ok pro
  volume atual, mas não escala pra milhares de contatos.
- `sent_count`/`failed_count` em `bulk_campaigns` são recalculados por
  `COUNT` a cada destinatário processado (não incrementados direto) —
  evita corrida entre execuções do worker, mas significa uma query a mais
  por destinatário.
- Fase 2 está fechada. Fase 3 (kanban do Inbox por status de conversa —
  combinado lá atrás, ainda não construído; relatório de contatos;
  import/export CSV) e Fase 4 (realtime em Kanban/Funil, configurações
  gerais ampliadas) seguem pendentes.

## 2026-09-23 (continuação) — Correção de rumo: sem painel "Monitor" separado

Usuário pediu ajuste na entrega anterior: não queria uma tela `/monitor`
paralela ao chat — queria que o gestor usasse o **mesmo** Inbox do
vendedor, estilo WhatsApp Web. Removido `/monitor` inteiro (rota, item da
sidebar) porque, na prática, o `/inbox` já mostrava todas as conversas da
organização pra qualquer papel — nunca foi restrito a "minhas conversas".
O painel separado era redundante.

**Regra de envio ficou uniforme, sem exceção de papel:** antes, gestor/admin
podia responder qualquer conversa sem assumir ("passe livre"); usuário
pediu pra tirar isso — confuso saber quem está de fato atendendo. Agora
`lib/actions/messages.ts` exige que TODO MUNDO (vendedor ou gestor) esteja
atribuído à conversa (ou ela esteja livre, aí responder já assume) antes
de mandar mensagem. Gestor continua podendo *tomar* uma conversa de outro
vendedor via "assumir" (`lib/actions/conversations.ts`, isso não mudou) —
só não pode mais responder sem clicar nesse botão antes.

**Modo leitura ficou visível na tela**, não só um erro depois de tentar
enviar: `MessageForm` agora recebe `readOnly`/`canClaim`/`outsideWindow`
em vez de um único `disabled` — quando a conversa é de outra pessoa, o
rodapé mostra "modo leitura" com o botão "Assumir" ali mesmo (só aparece o
botão pra quem realmente pode clicar: setor livre, ou gestor/admin tomando
de volta).

**Filtro por vendedor** na lista de conversas (`conversation-list.tsx`),
junto com o filtro por status que já existia — pedido explícito do
usuário, calculado a partir da própria lista carregada (sem query extra).

**Ordenação da lista corrigida:** antes só reordenava por mensagem
*recebida* (`last_inbound_at`); se a última coisa que aconteceu numa
conversa foi o vendedor respondendo, ela ficava "presa" no lugar errado.
Agora ordena pela mensagem mais recente em qualquer direção — como no
WhatsApp de verdade.

Realtime (lista + thread) já cobria tudo isso desde a Fase 1 —
`RealtimeListener` não precisou de nenhuma mudança, só passou a ser
importado também de onde for preciso no futuro em vez de viver só dentro
do Monitor removido.

## 2026-09-23 — Fase 2: Monitor (painel do gestor em tempo real)

Item 8 do plano de distribuição (item 7, disparo em massa, segue pendente
— depende de decidir a questão dos templates aprovados no Meta).

`/monitor` (novo, sidebar item "Monitor", só manager/admin/owner via
`requireRoleOrRedirect("manager")`): tabela com todas as conversas da
organização — cliente, setor, vendedor responsável (com pontinho de
presença ao vivo), última mensagem (indicando se foi o cliente ou o
vendedor que mandou) e status, com abas de filtro (Todas/Sem
vendedor/Aberta/Pendente/Resolvida/Fechada) e 3 cards de resumo (total,
sem vendedor, abertas). Atualiza sozinho via o mesmo `RealtimeListener` já
usado no Inbox (reaproveitado, não duplicado) — sem precisar recarregar.

Clicar em "Abrir" leva pro `/inbox/:id` de sempre — a thread completa (com
as duas direções da conversa) e a permissão de gestor responder qualquer
uma já existiam desde a Fase 1, não precisou duplicar nada disso aqui.

Extraído `lib/inbox/last-messages.ts` (helper `fetchLastMessageByConversation`)
a partir do que já existia em `app/(app)/inbox/layout.tsx`, agora usado
nos dois lugares — mesma lógica de "qual foi a última mensagem de cada
conversa", sem duplicar.

**Pendente:** disparo em massa + templates (Fase 2 restante); funil
separado do Kanban, relatório de contatos, import/export CSV (Fase 3);
realtime em Kanban/Funil e configurações gerais ampliadas (Fase 4).

## 2026-09-22 (continuação 2) — Fase 1 do plano de distribuição: presença, rodízio, assumir conversa

Início de um plano maior (4 fases) pedido pelo usuário: status de vendedor,
permissões, rodízio, distribuição automática, assumir conversa, novo
contato, disparo em massa, monitor de gestor, funil separado do Kanban,
agendamento, relatórios, import/export, realtime completo. Implementado
nesta rodada (migration `0013` + `0014`):

**Presença (online/ausente/offline):** `profiles.presence_status` +
`last_active_at`. Cliente manda heartbeat a cada 60s
(`components/presence/presence-heartbeat.tsx`) reportando 'online' ou
'away' (10min sem interação do mouse/teclado); "offline" nunca é escrito
pelo cliente — é sempre derivado no servidor (`fn_presence_status`,
espelhada em `lib/presence/status.ts`) comparando `last_active_at` com
agora (>3min parado = offline), porque fechar a aba não avisa ninguém.
Pontinho de status ao vivo na tela de Equipe via Realtime em `profiles`
(mesmo padrão do chat).

**Rodízio de vendedores:** `fn_next_rotation_member(team_id)` — função
seguindo o mesmo padrão de concorrência de `fn_claim_pending_events`
(`for update` na linha do setor, pra duas distribuições simultâneas não
escolherem a mesma pessoa). Só considera quem está online agora; nunca
repete o último vendedor em sequência enquanto houver outra pessoa
elegível. Só o setor "Venda Veículos Novos" começa com
`teams.auto_distribution = true` (Peças e Pós-Vendas continuam manuais até
o usuário decidir as regras deles) — `fn_create_organization` atualizada
pra organizações novas já nascerem assim.

Disparado automaticamente em dois pontos: lead novo criado sem
responsável escolhido à mão (`lib/actions/leads.ts`), e conversa nova do
WhatsApp (`lib/whatsapp/process-events.ts`, que também grava
`conversations.team_id`). Sem ninguém online, fica sem dono — alguém
assume manualmente depois.

**Botão "assumir conversa"** (`lib/actions/conversations.ts`,
`claimConversation`): vendedor comum só assume conversa livre ou já seria
sua; gestor/admin pode tomar de qualquer um. Responder uma conversa sem
dono também assume automaticamente (não precisa clicar "assumir" antes de
digitar). Isso trouxe uma regra de permissão nova: vendedor não consegue
mais responder conversa atribuída a outro colega (`lib/actions/messages.ts`)
— gestor/admin não tem essa restrição, para não travar supervisão.

**Novo contato dentro do Inbox:** o formulário já existia em `/contatos`;
agora também abre direto da lista de conversas (ícone "+" ao lado de
"Conversas").

**Detecção de duplicidade por e-mail:** `contacts.email` (opcional, novo)
+ índice único parcial case-insensitive por organização — mesmo
tratamento que telefone já tinha. Mensagem de erro diferencia qual dos
dois duplicou.

**Pendente / decisões que ainda dependem do usuário:**
- Presença: sem toggle de UI pra ligar/desligar rodízio automático por
  setor ainda — só via SQL direto (`teams.auto_distribution`). Se quiser
  gerenciar isso pela tela de Equipe, é rápido de adicionar.
- "Permissões" (item 2 do plano): a base de papéis (owner/admin/manager/
  agent) já existia inteira antes desta rodada; o que mudou aqui foi só a
  regra de propriedade de conversa. Não foi feita uma auditoria completa
  tela-por-tela — se quiser essa revisão formal, é um próximo passo
  separado.
- Balanceamento por carga (em vez de round robin puro) — combinado que
  fica para depois.
- Regras de distribuição por origem/horário/campanha — ainda não
  desenhadas (usuário confirmou que por enquanto é só rodízio).
- Fase 2 em diante (disparo em massa + templates, monitor do gestor,
  kanban do Inbox por status, funil separado, agendamento de visitas,
  relatório de contatos, import/export CSV) ainda não começou.

**Rodar no Supabase antes de testar:** migrations `0013` e `0014`.

## 2026-09-22 (continuação) — Tema escuro completo (preto + amarelo + branco)

Pedido explícito do usuário para virar o fundo inteiro do CRM (antes só a
sidebar era escura). `app/globals.css`: reescrito o bloco `:root` inteiro
— fundo `#0a0a0a`, cards `#18181b`, texto `#fafafa`, `--accent` virou
âmbar escuro com texto amarelo vivo (antes era pastel claro com texto
marrom). `--primary` (amarelo `#facc15`) e os tokens da sidebar não
mudaram — já estavam certos. Login/cadastro/onboarding herdam o tema de
graça, já que usam `bg-background`/`Card` em vez de cor fixa.

Como a maior parte do app já usa classes de token (`bg-card`,
`text-foreground` etc.), a troca dos tokens bastou para a maioria das
telas. O que tinha cor **fixa em hexadecimal** (calculada pensando em
fundo claro) precisou de ajuste manual, porque senão ficaria invisível
em cima do novo fundo escuro:
- Avatares (`bg-[#18181b] text-white`) em Contatos, Equipe, Dashboard,
  Chat WhatsApp → viraram `bg-primary text-primary-foreground` (círculo
  amarelo).
- `components/app-shell/topbar.tsx` tinha `bg-white` fixo → `bg-card`.
- Badge de setor no card do funil (`border-[#27272a]/20` etc., cinza-escuro
  sobre cinza-escuro) → branco translúcido (`border-white/15 bg-white/5`).
- Ícone "escuro" alternado do KPI do dashboard e o card de atalho
  "Contatos" → viraram brancos (senão ficavam da cor do próprio card).
- Banner de boas-vindas do dashboard ganhou `ring-1 ring-white/10` e o
  gradiente passou a terminar em âmbar escuro em vez de cinza, pra não
  se misturar com o fundo novo.

**Pendente:** trocar a logo da sidebar por uma nova versão que o usuário
enviou (fundo transparente/branco, mesmo logotipo Renault Gamboa) — só
falta o caminho do arquivo salvo em disco para eu aplicar.

## 2026-09-22 — Configurações unificada em uma seção com abas

Antes: "Equipe", "Conexões" e "Configurações" eram 3 itens soltos na
sidebar, cada um com seu próprio título de página. Unificado em uma seção
só, padrão comum de SaaS:
- `app/(app)/configuracoes/layout.tsx` (novo): título "Configurações" +
  `<SettingsTabs>` compartilhados por Geral/Equipe/Conexões — as 3 rotas
  continuam existindo do jeito que estavam (nada mudou de URL nem de
  Server Action), só ganharam um layout em comum por cima.
- `app/(app)/configuracoes/settings-tabs.tsx` (novo): abas com estado
  ativo via `usePathname`, mesmo padrão já usado na sidebar.
- Sidebar: os 3 itens viraram 1 ("Configurações", aponta para
  `/configuracoes/geral`) — `activePrefix` novo no `NavItem` faz esse item
  continuar destacado em `/configuracoes/equipe` e `/configuracoes/whatsapp`
  também, não só na aba padrão.
- Cada página perdeu o `<h1>` próprio (agora redundante com o da seção) e
  ficou só com uma linha de descrição curta.

## 2026-09-21 — Notificações, audit_log completo e Realtime no chat

**Notificações (sino do topo, agora funcional):** migration `0012` cria a
tabela `notifications` (RLS: cada um só lê a própria caixa; insert é aberto
a qualquer membro da mesma org, porque notificar um colega é sempre uma
escrita para OUTRO usuário). `lib/notifications/create.ts` é o helper
fire-and-forget (mesmo padrão de `lib/audit/log.ts`). Dispara em dois
lugares:
- `lib/actions/leads.ts`: lead atribuído a alguém (`createLead`/`updateLead`)
  notifica o novo responsável, exceto quando a pessoa se atribui o próprio
  lead.
- `lib/whatsapp/process-events.ts`: toda mensagem nova recebida no
  WhatsApp notifica todos os membros aceitos da organização (`link` aponta
  pra conversa em `/inbox/:id`).
`components/app-shell/topbar.tsx` ganhou o dropdown de verdade (contador de
não lidas, marcar uma ou todas como lidas). Sem realtime nesse sino de
propósito — atualiza ao navegar entre páginas, que já é suficiente pro que
foi pedido; se um dia precisar instantâneo, dá pra reusar a mesma inscrição
Realtime do chat.

**`audit_log` — cobertura que faltava, fechada:** `contact.created`,
`contact.updated`, `tag.created`, `tag.deleted`, `pipeline.vocabulary_updated`,
`pipeline.stage_created`, `pipeline.stage_renamed`, `pipeline.stage_deleted`,
`invite.created`, `invite.accepted`. Junto com o que já existia
(lead/setor/organização), agora toda mutação relevante do app grava linha —
fecha a dívida da regra 4 do `CLAUDE.md` que estava em aberto desde a Fase 4.

**Realtime no Chat WhatsApp:** migration `0012` também entra `messages` e
`conversations` na publicação `supabase_realtime` (sem isso, INSERT/UPDATE
nessas tabelas não chega em client nenhum, mesmo com Realtime "ligado" no
projeto). `app/(app)/inbox/realtime-listener.tsx` é um Client Component sem
UI, montado no layout do Inbox: abre uma inscrição via
`lib/supabase/client.ts` filtrada por `org_id` e, em qualquer mudança em
`messages`/`conversations`, chama `router.refresh()`. Decisão: em vez de
reconciliar mensagem-por-mensagem no estado do cliente (arriscado sob
reconexão/perda de evento), deixa o Next.js re-buscar os Server Components
da rota atual — lista de conversas e thread aberta atualizam sozinhas,
sem duplicar lógica de merge no cliente. Cobre tanto mensagem nova quanto
atualização de status de entrega (sent → delivered → read).

**Pendente:**
- Rodar a migration `0012` no Supabase (SQL Editor) — sem ela, a tabela
  `notifications` não existe (o sino quebra) e Realtime não entrega nada
  em `messages`/`conversations` (chat não atualiza sozinho).
- Ainda não testado com tráfego real de WhatsApp (mesma pendência de
  sempre: falta conectar o número).
- Busca do header continua só visual — não foi pedida ainda.

## 2026-09-18 (continuação 2) — Configurações, Relatórios, Automações e Inbox do WhatsApp

**Configurações (`/configuracoes/geral`):** formulário simples para renomear
a organização, admin/owner só. `updateOrganization` grava em `audit_log`.

**Relatórios (`/relatorios`):** filtro por período (data de/até, form GET),
cartela de clientes que entraram em contato no período (hoje isso é
`leads.created_at`, já que sem WhatsApp conectado o cadastro manual do lead
é o único ponto de entrada — quando o Inbox passar a criar lead a partir da
primeira mensagem, a consulta não muda). Cards de resumo (total, ganhos,
perdidos, valor em aberto). Exportação **sem biblioteca nova**, como
combinado:
- CSV: `/relatorios/export` (Route Handler — precisa de `Content-Disposition`
  para forçar download, isso não dá para fazer só com Server Action).
  BOM UTF-8 no início do arquivo para o Excel do Windows não bagunçar
  acentuação.
- PDF: botão "Imprimir" chama `window.print()`; `print:hidden` em
  sidebar/topbar/filtros e `print:border-none` no card da tabela via CSS
  (`components/app-shell/sidebar.tsx`, `topbar.tsx`, `app/(app)/layout.tsx`).

**Automações (`/automacoes`):** o limite de "lead parado" (antes fixo em `3`
dias direto no código, em dois arquivos diferentes) virou
`organizations.stage_alert_days` (migration `0011`), editável nesta tela.
`dashboard/page.tsx` e `funil/kanban-board.tsx` agora recebem esse número
por prop em vez do valor fixo. A tela também lista as últimas 50 linhas de
`event_log` (fila de automação) com status — hoje tudo fica "pendente"
porque não existe worker rodando ainda em produção; isso é o esperado, não
bug.

**Inbox do WhatsApp — infraestrutura completa, pronta para o número real:**
seguindo exatamente o que ficou anotado como pendente na pausa da Fase 2
(ver entrada de 2026-09-15 mais abaixo), sem inventar arquitetura nova:
- Migration `0006` (`fn_claim_pending_events`) finalmente **precisa ser
  aplicada** — nada dependia dela até agora, agora o worker depende.
- `/configuracoes/whatsapp`: tela de conexão do canal. Valida
  WABA ID + Phone Number ID + token contra a Graph API de verdade
  (`getPhoneNumberInfo`) antes de salvar; token cifrado em Node
  (`lib/crypto/token-cipher.ts`, já existia) antes de ir para
  `channels.access_token_encrypted`. Mostra a Callback URL e o Verify Token
  prontos para colar no painel da Meta.
- `app/api/webhooks/whatsapp/route.ts`: `GET` responde o handshake
  (`hub.challenge`) só se o verify token bater; `POST` valida a assinatura
  HMAC do corpo cru **antes** de qualquer parse, grava em
  `webhook_deliveries`, enfileira em `event_log` (`whatsapp_inbound_message`
  / `whatsapp_status_update`, com `dedupe_key` — reentrega da Meta é
  esperada, não erro) e responde 200 imediatamente. Não processa nada pesado
  dentro do webhook (regra do `CLAUDE.md`).
- `app/api/cron/process-events/route.ts` + `lib/whatsapp/process-events.ts`:
  worker protegido por `CRON_SECRET` no header `Authorization`. Reivindica
  lote via `fn_claim_pending_events`, cria/atualiza contato e conversa,
  grava a mensagem (idempotente no `wamid`), atualiza status de entrega.
  `vercel.json` agenda esse endpoint a cada minuto (Vercel injeta o
  `Authorization: Bearer $CRON_SECRET` sozinho quando a env var existe).
- `/inbox`: layout de duas colunas (lista de conversas + thread). Sem canal
  conectado, mostra call-to-action para `/configuracoes/whatsapp` em vez de
  uma tela vazia sem explicação. Envio de texto (`lib/actions/messages.ts`)
  respeita a janela de 24h da Cloud API (`lib/whatsapp/window.ts`) — fora
  da janela, o campo de texto vem desabilitado com o aviso, sem tentar
  chamar a Graph API e falhar.
- **Ainda não testado ao vivo** — mesma condição de sempre: precisa do
  número real conectado. Todo esse código foi escrito e passa
  typecheck/lint/build, mas o critério de fechar a Fase 2 continua sendo
  "mando mensagem do celular e ela aparece em menos de 5s".

**Pendente / próximos passos:**
- Rodar migrations `0006` e `0011` no Supabase (SQL Editor) — sem isso,
  `/dashboard`, `/funil` e `/automacoes` quebram (coluna
  `stage_alert_days` não existe) e o worker do WhatsApp não tem a função
  que precisa.
- Conectar o número real e testar o fluxo ponta a ponta.
- Realtime (mensagem nova aparecer sem recarregar) ficou fora de propósito
  — sem número conectado não tinha como testar; a tela hoje só atualiza ao
  navegar.

## 2026-09-18 (continuação) — Reskin visual + performance + Setores

**Performance (causas reais encontradas e corrigidas, não achismo):**
- Nenhuma rota tinha `loading.tsx` — navegação ficava "congelada" até todo
  o carregamento terminar. Adicionado skeleton por rota (dashboard, funil,
  contatos, perfil do contato, equipe).
- `getUser()`/`getActiveOrgMembership()` rodavam em duplicidade dentro da
  mesma página (layout chamava, página chamava de novo) — cada chamada é
  uma validação de JWT contra o Supabase pela rede. Envolvidas em `cache()`
  do React (`lib/auth/session.ts`) — dentro de uma mesma requisição, a
  validação agora acontece uma vez só, não 3-4 vezes.
- `contatos/[contactId]/page.tsx` tinha uma espera desnecessária (buscava
  contato, só depois buscava os leads, mesmo os leads não dependendo do
  resultado do contato) — as duas rodam em paralelo agora.

**Reskin visual completo** (especificação detalhada dada pelo usuário —
preto + amarelo, estilo "dashboard SaaS premium"):
- `app/globals.css`: paleta nova (fundo `#f8fafc`, cards brancos, primário
  `#facc15`, sidebar em gradiente `#0d0d0d→#1a1a1a`).
- Sidebar: gradiente escuro, item ativo em amarelo sólido com texto preto,
  rodapé com avatar+nome+cargo do usuário.
- Header novo (`components/app-shell/topbar.tsx`): busca (só visual, não
  filtra nada ainda), sino de notificação (decorativo, sem contagem real),
  avatar com menu de sair.
- Dashboard: banner de boas-vindas em gradiente preto com mini-cards
  translúcidos, KPIs com ícone circular alternado + variação percentual
  real vs. mês anterior (cálculo novo, só leitura, não mexe em nenhuma
  mutação), grid de ações rápidas, cards de conteúdo com avatar/iniciais.
- `components/ui/card.tsx`: sombra sutil + elevação no hover, aplicado a
  toda a aplicação de uma vez (Contatos, Funil, Equipe herdam de graça).
- `lib/format/initials.ts` criado para não duplicar a lógica de iniciais
  que já existia dentro do kanban.

**Setores (nova estrutura, não é a mesma tela de "Equipe"):**
- Migration `0010`: tabelas `teams` e `team_members`, coluna
  `leads.team_id`. 4 setores padrão semeados para orgs existentes e para
  organizações novas (`fn_create_organization` atualizada):
  Venda Veículos Novos, Setor de Peças, Setor de Pós-Vendas, Gerência.
- Tela de Equipe ganhou seção "Setores": criar setor, marcar/desmarcar
  membros por setor (checkbox).
- Lead ganhou campo "Setor" (select) — já filtrável/visível no card do
  funil como badge.
- **Importante:** o roteamento automático de conversa do WhatsApp pro
  setor certo por intenção do cliente **não existe ainda** — isso depende
  do canal estar conectado (Fase 2, pausada) e de automações. O que existe
  hoje é só a estrutura de dados + atribuição manual.

**Pendente:**
- Relatórios e Automações continuam só "em breve" na sidebar — ainda não
  construídos.
- Busca do header e sino de notificação são só visuais, sem lógica real
  ainda.
- `audit_log` agora recebe `lead.created`/`lead.updated`/`lead.stage_changed`/
  `team.created`/`team.deleted` — ainda não cobre todas as mutações
  (contatos, convites, tags, configurações de pipeline continuam sem
  auditoria).

## 2026-09-18 — CRM adaptado para concessionária (Renault Gamboa)

**Decisão de escopo** (o usuário pediu um sistema completo de concessionária
— veículos/estoque, financiamento, multi-loja, agentes de IA configuráveis
— e depois recuou): **não** vamos construir módulos de Financiamento,
Estoque, Veículos (como cadastro/inventário) nem Lojas. O pedido virou
"estrutura bacana funcionável e moderna" em cima do que já existe.

**Feito:**
- Repositório publicado no GitHub: `https://github.com/bzindev/crm-gamboa-ajustar`
  (privado). `.env.local` confirmado fora do controle de versão.
- Tema visual trocado para preto + amarelo (era verde) — ver
  `app/globals.css`. Foi a 3ª tentativa de cor nesta conversa; **não trocar
  de novo sem pedido explícito**, já causou retrabalho.
- Bug real corrigido: `--font-sans: var(--font-sans)` era uma referência
  circular deixada por uma tentativa parcial de `shadcn init` — o texto
  caía na fonte serifada padrão do navegador em vez da Geist Sans.
- Sidebar simplificada para lista plana (sem cabeçalho de grupo — o
  DeskcommCRM de referência também não agrupa), com mais itens "em breve"
  (Relatórios, Automações, Configurações gerais).
- Página de perfil do contato (`/contatos/[contactId]`) com histórico de
  leads e tags agregadas.
- **Migration `0008`**: funil trocado de `Novo/Em contato/Proposta/Fechado`
  para o vocabulário de concessionária:
  `Lead → Em atendimento → Follow-up → Agendado → Compareceu → No-show →
  Venda → Perdido`. Os 8 leads de exemplo foram redistribuídos
  automaticamente pela própria migration (won → Venda, lost → Perdido).
  `fn_create_organization` atualizada para organizações novas já nascerem
  com esse funil.
- Campos novos em `leads`: `vehicle_interest` (texto livre, sem tabela de
  estoque), `temperature` (`cold`/`warm`/`hot`, exibido como badge no
  card — quente usa a cor primária + 🔥), `origin`, `campaign`.
- Dashboard ganhou card "Leads quentes".
- Dados de exemplo enriquecidos com esses campos (script rodado uma vez,
  não versionado — os valores já estão no banco).

**Pendente:**
- `audit_log` schema existe mas nenhuma action grava nele ainda — dívida
  real, viola a regra 4 do `CLAUDE.md`. Vale corrigir antes do projeto
  crescer mais.
- WhatsApp continua pausado (número em uso em outro CRM).
- Sem decisão de provedor de IA ainda.
- Sidebar lista "Automações", "Chamados", "Agenda", "Disparo em massa",
  "Templates WhatsApp" como possíveis próximos módulos — nenhum tem
  schema ou tela ainda.

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
