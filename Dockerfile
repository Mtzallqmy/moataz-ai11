# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS build
WORKDIR /app

ENV CI=true \
    NODE_ENV=development \
    NPM_CONFIG_PRODUCTION=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json .npmrc ./
COPY scripts/ensure-runtime-dirs.mjs ./scripts/ensure-runtime-dirs.mjs
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build \
  && npm prune --omit=dev --no-audit --no-fund \
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
COPY --from=build --chown=node:node /app/drizzle ./drizzle

RUN mkdir -p /app/workspace \
  && chown -R node:node /app/workspace

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

STOPSIGNAL SIGTERM
ENTRYPOINT ["tini", "--"]
CMD ["node", "dist/server/index.js"]
