# syntax=docker/dockerfile:1
#
# One image for all three processes (api, realtime, worker). The command picks the entry point:
#   node dist/main-api.js | node dist/main-realtime.js | node dist/main-worker.js
#
# Stages:  deps -> build -> (prod-deps) -> runtime.   The `build` stage also carries the Prisma
# CLI, so docker-compose uses it as the one-shot `migrate` job. The runtime image does not.

ARG NODE_VERSION=26

FROM node:${NODE_VERSION}-slim AS base
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# ---- all dependencies (dev included) ---------------------------------------------------------
FROM base AS deps
COPY package.json package-lock.json ./
# --ignore-scripts: no dependency may run code at install time (supply-chain hardening).
RUN npm ci --ignore-scripts

# ---- build -------------------------------------------------------------------------------------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
# prisma generate needs no database; nest build compiles to dist/ (ESM).
RUN npx prisma generate && npx nest build

# ---- production dependencies only ---------------------------------------------------------------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# ---- runtime ------------------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node scripts/healthcheck.mjs ./scripts/healthcheck.mjs

# Never run as root.
USER node

# Documentation only: the real ports come from PORT_API / PORT_REALTIME at run time.
EXPOSE 3000 3001

# Slim images have no curl, so the check is a tiny Node script. Containers that listen on
# another port set HEALTHCHECK_PORT; the worker has no HTTP listener and disables this.
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
  CMD ["node", "scripts/healthcheck.mjs"]

CMD ["node", "dist/main-api.js"]
