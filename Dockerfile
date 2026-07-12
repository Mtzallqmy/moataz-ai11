# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build
WORKDIR /app

# Railway may inject NODE_ENV=production during image builds. The build stage
# still needs ESLint, TypeScript, Vite and Vitest from devDependencies.
ENV CI=true \
    NODE_ENV=development \
    NPM_CONFIG_PRODUCTION=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
# npm executes the package postinstall hook during npm ci, so the hook must be
# available before the rest of the source tree is copied.
COPY scripts/ensure-runtime-dirs.mjs ./scripts/ensure-runtime-dirs.mjs

# Keep this command compatible with Railway's Dockerfile parser. A BuildKit
# cache mount was removed because Railway requires an explicit cache id and
# rejected the Dockerfile before the build started.
# Install platform optional binaries required by Vite/Rollup, but skip lifecycle
# scripts so the development-only native SQLite addon is never compiled in Railway.
RUN npm ci --include=dev --ignore-scripts --no-audit --no-fund \
  && node scripts/ensure-runtime-dirs.mjs

COPY . .

# Validation remains in GitHub Actions. Railway only performs the production
# build so deploys are deterministic and do not spend minutes rerunning tests.
RUN npm run build \
  && npm prune --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund \
  && npm cache clean --force

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist

RUN mkdir -p /app/data /app/workspace \
  && chown -R node:node /app/data /app/workspace

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server/index.js"]
