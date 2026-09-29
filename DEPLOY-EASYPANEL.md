# Deploy na VPS com EasyPanel

A imagem é gerada pelo `Dockerfile` da raiz. Dentro do container,
`scripts/start.mjs` sobe o Next e faz o papel do Vercel Cron (fila a cada
1 minuto, backup diário às 06:00 UTC). O banco continua no Supabase — nada
de banco na VPS.

## 1. Criar o serviço

1. EasyPanel → seu projeto → **+ Service → App**. Nome: `crm`.
2. **Source → GitHub**: repositório `bzindev/crm-gamboa-ajustar`, branch
   `main`, caminho `/`.
3. **Build → Dockerfile** (arquivo `Dockerfile`).

## 2. Variáveis (aba Environment)

Copie os valores do seu `.env.local`, trocando só o domínio:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_APP_URL=https://crm.seudominio.com.br
SUPABASE_SERVICE_ROLE_KEY=...
WHATSAPP_APP_SECRET=...
WHATSAPP_WEBHOOK_VERIFY_TOKEN=...
WHATSAPP_GRAPH_API_VERSION=...
TOKEN_ENCRYPTION_KEY=...
CRON_SECRET=...
```

- `NEXT_PUBLIC_*` são usadas no **build** (vão pro JavaScript do
  navegador). Se mudar alguma, faça **Deploy de novo** — reiniciar não basta.
- `TOKEN_ENCRYPTION_KEY` tem que ser **a mesma** do ambiente atual, senão o
  token do WhatsApp salvo no banco não abre.
- Nunca coloque nenhuma dessas no repositório (ele é público).

## 3. Domínio e porta

**Domains** → adicionar `crm.seudominio.com.br`, HTTPS ligado, porta do
container **3000**. No seu provedor de DNS, crie um registro **A**
apontando o subdomínio pro IP da VPS.

## 4. Deploy

Clique em **Deploy**. O build leva alguns minutos. Pronto quando o log
mostrar `Ready` e `[cron] agendador interno ligado`.

## 5. Depois do primeiro deploy

- **Supabase → Authentication → URL Configuration**: `Site URL` =
  `https://crm.seudominio.com.br` e adicione
  `https://crm.seudominio.com.br/**` em **Redirect URLs** (convites e login).
- **Meta (WhatsApp) → Webhook**: URL de callback
  `https://crm.seudominio.com.br/api/webhooks/whatsapp`, token de
  verificação = `WHATSAPP_WEBHOOK_VERIFY_TOKEN`.
- Se o projeto também estiver na Vercel, desligue os crons de lá (ou o
  projeto inteiro) — senão a fila roda em dois lugares.

## Atualizar

`git push` na `main` → EasyPanel → **Deploy** (ou ligue o
**Auto Deploy** na aba Source).
