FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production HOME=/tmp PRISMA_HIDE_UPDATE_MESSAGE=1
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl tini && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/prisma ./prisma
COPY --chown=node:node package.json docker-entrypoint.sh ./
USER node
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--", "sh", "/app/docker-entrypoint.sh"]
