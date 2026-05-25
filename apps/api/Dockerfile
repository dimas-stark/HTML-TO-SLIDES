FROM node:20-alpine
WORKDIR /app

COPY package.json ./
COPY turbo.json ./
COPY packages/shared-types  ./packages/shared-types
COPY packages/html-parser   ./packages/html-parser
COPY apps/api               ./apps/api

RUN npm install --workspaces --include-workspace-root

EXPOSE 4000
CMD ["node", "-r", "ts-node/register/transpile-only", "apps/api/src/index.ts"]
