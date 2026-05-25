FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY turbo.json ./
COPY tsconfig.json ./
COPY tsconfig.base.json ./
COPY packages/shared-types  ./packages/shared-types
COPY apps/web               ./apps/web

RUN npm install --workspaces --include-workspace-root
RUN cd apps/web && npm run build
RUN cp -r apps/web/public apps/web/.next/standalone/apps/web/public || true
RUN mkdir -p apps/web/.next/standalone/apps/web/.next && cp -r apps/web/.next/static apps/web/.next/standalone/apps/web/.next/static

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]
