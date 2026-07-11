FROM node:20-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git make g++ python3 unzip \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app /workspace \
  && chown -R node:node /app /workspace

WORKDIR /app
COPY --chown=node:node server.mjs ./server.mjs

USER node
ENV NODE_ENV=production \
    SANDBOX_WORKSPACE_DIR=/workspace

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
