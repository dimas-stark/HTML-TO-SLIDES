# ── Stage 1: Build ────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json ./
COPY turbo.json ./
COPY tsconfig.json ./
COPY tsconfig.base.json ./
COPY packages/shared-types  ./packages/shared-types
COPY apps/web               ./apps/web

RUN npm install --workspaces --include-workspace-root
RUN cd apps/web && npm run build

# ── Stage 2: Runner ───────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Copy standalone server output
COPY --from=builder /app/apps/web/.next/standalone ./

# Copy static assets (CSS, JS chunks) — REQUIRED for standalone mode
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

# Copy public folder (icons, images, etc)
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["node", "apps/web/server.js"]
