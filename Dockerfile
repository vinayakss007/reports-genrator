# Multi-stage production Dockerfile
# Stage 1: install + build
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/ packages/
COPY apps/ apps/
COPY tsconfig.base.json ./
RUN pnpm install --frozen-lockfile=false
RUN pnpm build

# Stage 2: production runtime (API only; web is served via CDN/nginx)
FROM node:22-alpine AS api
RUN corepack enable && corepack prepare pnpm@10.28.1 --activate
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/pnpm-lock.yaml /app/pnpm-workspace.yaml /app/package.json ./
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/apps/api/ apps/api/
RUN pnpm install --prod --frozen-lockfile=false
# Remove source to keep the image lean
RUN find packages apps -name "src" -type d -exec rm -rf {} + 2>/dev/null || true

EXPOSE 3001
ENV API_PORT=3001
ENV DATA_DIR=/data
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/server.js"]

# Stage 3: web static build (serve with nginx or any CDN)
FROM nginx:alpine AS web
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
