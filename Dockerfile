# Imagem de produção do CRM (VPS com EasyPanel ou qualquer Docker).
# Três etapas: instala dependências → compila → imagem final enxuta, só
# com o build "standalone" do Next (sem código-fonte nem node_modules
# completo).

# ---------------------------------------------------------------------------
# 1. Dependências
# ---------------------------------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache libc6-compat
COPY package.json package-lock.json ./
RUN npm ci

# ---------------------------------------------------------------------------
# 2. Build
# ---------------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Variáveis NEXT_PUBLIC_* são gravadas no JavaScript do navegador DURANTE o
# build — por isso entram como build args (no EasyPanel: aba Environment,
# que ele repassa ao build). São públicas por natureza (a chave anon é
# protegida pela RLS). Segredo NENHUM entra aqui: service role, token da
# Meta, CRON_SECRET etc. são só de runtime (etapa 3).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_APP_URL
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_TELEMETRY_DISABLED=1

# Falha cedo e com mensagem clara, em vez de gerar uma imagem que abre com
# tela em branco por falta de URL do Supabase.
RUN test -n "$NEXT_PUBLIC_SUPABASE_URL" && test -n "$NEXT_PUBLIC_SUPABASE_ANON_KEY" && test -n "$NEXT_PUBLIC_APP_URL" \
  || (echo "Faltam NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / NEXT_PUBLIC_APP_URL no build." && exit 1)

RUN npm run build

# ---------------------------------------------------------------------------
# 3. Imagem final
# ---------------------------------------------------------------------------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# Não roda como root.
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs nextjs

COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/scripts/start.mjs ./start.mjs

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/login || exit 1

# start.mjs sobe o server.js e o agendador que substitui o Vercel Cron.
CMD ["node", "start.mjs"]
