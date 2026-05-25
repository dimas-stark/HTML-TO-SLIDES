# Worker Dockerfile — uses official Playwright image (Chromium pre-installed)
FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copy root workspace files
COPY package.json ./
COPY turbo.json ./
COPY tsconfig.json ./
COPY tsconfig.base.json ./

# Copy all packages the worker depends on
COPY packages/shared-types   ./packages/shared-types
COPY packages/html-parser    ./packages/html-parser
COPY packages/rendering-engine ./packages/rendering-engine
COPY packages/export-engine  ./packages/export-engine
COPY workers/export-worker   ./workers/export-worker

# Install all workspace dependencies
RUN npm install --workspaces --include-workspace-root

# Build TypeScript (each package)
RUN cd packages/shared-types    && npx tsc --noEmit false --outDir dist --declaration true || true
RUN cd packages/html-parser     && npx tsc --noEmit false --outDir dist || true
RUN cd packages/rendering-engine && npx tsc --noEmit false --outDir dist || true
RUN cd packages/export-engine   && npx tsc --noEmit false --outDir dist || true
RUN cd workers/export-worker    && npx tsc --noEmit false --outDir dist || true

# Critical: Chromium flags for LXC environment
ENV PLAYWRIGHT_CHROMIUM_LAUNCH_OPTIONS_ARGS="--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage"

CMD ["node", "-r", "ts-node/register/transpile-only", "workers/export-worker/src/index.ts"]
