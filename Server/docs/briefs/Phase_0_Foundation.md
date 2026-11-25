# Server Phase 0 — Foundation

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** about 1 week
**Unlocks:** every later phase
**Goal:** an empty but production-shaped server: it builds, runs locally with all its infrastructure, refuses bad config, logs safely, and has CI and contract drafts.

---

## 1. Scope

In scope: repository, tooling, local Docker stack, config, logging, error handling, health checks, Prisma setup, CI, contract drafts.
Out of scope: any business endpoint (auth, devices, sessions), any cloud deployment.

## 2. Tasks

### 2.1 Repository and tooling
1. Create `mobiledesk-server/` with this layout:
   ```text
   contracts/            openapi.yaml, asyncapi.yaml
   src/
     main-api.ts         API process
     main-realtime.ts    Socket.IO process (starts empty)
     main-worker.ts      BullMQ worker process (starts empty)
     app.module.ts
     common/             config/, logger.ts, errors/, guards/, validation/
     modules/health/
   prisma/schema.prisma
   test/                 unit/, integration/, security/
   infra/                docker-compose.yml, coturn/turnserver.conf.example
   docs/                 ARCHITECTURE.md, RUNBOOKS.md (stubs)
   ```
2. TypeScript strict + `noUncheckedIndexedAccess`; ESLint (typescript-eslint, recommended-type-checked) and Prettier.
3. `package.json` scripts: `dev:api`, `dev:realtime`, `dev:worker`, `build`, `lint`, `typecheck`, `test`, `test:integration`, `prisma:migrate`, `contracts:types`.
4. `.gitignore` covers `.env*` (except `.env.example`), `node_modules`, `dist`, coverage.

### 2.2 Config (fail closed)
- `src/common/config/config.schema.ts`: zod schema for every variable. Process exits with a clear message (without printing values) if any is missing or invalid.
- Initial variables: `NODE_ENV`, `PORT_API`, `PORT_REALTIME`, `DATABASE_URL`, `REDIS_URL`, `LOG_LEVEL`, `CORS_ORIGINS` (empty for mobile-only), `APP_PUBLIC_BASE_URL`.
- `.env.example` with names and safe placeholders only.

### 2.3 Logging and errors
- pino logger with `redact` paths: `req.headers.authorization`, `*.password`, `*.token`, `*.accessToken`, `*.refreshToken`, `*.ticket`, `*.sdp`, `*.candidate`, `*.credential`, `*.fcmToken`, `*.integrityToken`. Censor value `[REDACTED]`.
- Request ID on every request (`x-request-id`, generated if absent) included in logs and error responses.
- Global exception filter producing `{ error: { code, message } }`. Unknown errors → `500` with `code: "internal_error"` and no stack trace in the response.
- `src/common/errors/codes.ts` with initial codes: `validation_failed`, `unauthorized`, `forbidden`, `not_found`, `rate_limited`, `conflict`, `internal_error`, `service_unavailable`.

### 2.4 Validation
- A `ZodValidationPipe` (or equivalent) used by all controllers; unknown keys rejected (`.strict()`); body size limit 64 KB.

### 2.5 Health
- `GET /health` → `{ status: "ok" }` if the process is up.
- `GET /ready` → checks Postgres (`SELECT 1`) and Redis (`PING`) with a 1 s timeout; `503` if either fails.

### 2.6 Database
- Prisma configured against Postgres; first migration creates nothing but `_prisma_migrations` (or a trivial `app_meta` table).
- Prisma 7+: the connection URL is **not** allowed in `schema.prisma`. Put it in `prisma.config.ts` (read from the validated config) and pass the database adapter to `PrismaClient`, following the current Prisma docs. The schema snippets in Phases 2–4 have been validated against Prisma's schema validator.

### 2.7 Local stack — `infra/docker-compose.yml`
- Services: `postgres:16`, `redis:7` (with `requirepass` from `.env`), `coturn` (image `coturn/coturn`, config from `infra/coturn/`, not started by default — profile `turn`), `api`, `realtime`, `worker`.
- Postgres and Redis bound to `127.0.0.1` only.

### 2.8 Contracts (drafts)
- `contracts/openapi.yaml`: info, servers, error schema, bearer auth scheme, `/health`, `/ready`, plus **stubbed** paths for every endpoint in the architecture doc (marked `x-status: planned`).
- `contracts/asyncapi.yaml`: channel and message stubs for every realtime event in the architecture doc.
- `npm run contracts:types` generates TypeScript types (e.g. `openapi-typescript`). Share both files with the app team.

### 2.9 CI — `.github/workflows/ci.yml`
On pull request and push to `main`: install with lockfile → typecheck → lint → unit tests → integration tests (Postgres + Redis service containers) → `npm audit --audit-level=high` → gitleaks → build Docker image (no push yet).

### 2.10 Dockerfile
Multi-stage build, non-root user, `NODE_ENV=production`, only `dist` and production dependencies in the final image, a `HEALTHCHECK` hitting `/health`.

## 3. Required tests

- Config: missing `DATABASE_URL` → process exits non-zero, output does not contain any env values.
- Logger: logging an object with `password`, `token`, `sdp` prints `[REDACTED]`.
- Errors: unknown route → `404` with standard shape; thrown generic error → `500` `internal_error`, no stack in body.
- Validation: unknown field in a sample body → `400 validation_failed`.
- `/ready` returns `503` when Redis is stopped (integration).

## 4. Gate

- [ ] `docker compose up` starts Postgres, Redis, API, realtime and worker; `/health` and `/ready` return 200.
- [ ] Server refuses to start with a missing required variable.
- [ ] CI green on a pull request, including gitleaks and `npm audit`.
- [ ] Contract drafts committed and shared with the app team.
- [ ] Phase report submitted (rules §4).
