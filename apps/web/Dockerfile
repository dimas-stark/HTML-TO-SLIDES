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

EXPOSE 3000
ENV NODE_ENV=production
CMD ["node", "apps/web/.next/standalone/apps/web/server.js"]
