# Phase 0 report — Foundation

```text
PHASE: 0 — Foundation
STATUS: Partial — code, tests, contracts and the Docker gate items are done and verified
        (2026-11-26); only the GitHub items (CI run, app-team handover) remain.
GATE: Not passed — 3 of 5 items passed; CI run and contract hand-over need your OK (see below).
```

## Gate checklist (brief §4)

| Gate item                                                                                            | State                     | Evidence / what is missing                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker compose up` starts Postgres, Redis, API, realtime, worker; `/health` and `/ready` return 200 | ☑ **Passed** (2026-11-26) | Docker 29.9.3 / Compose 5.7.1. `up -d --build`: both images built, `migrate` exited 0, api/realtime/postgres/redis `healthy`, worker up. `GET /health` → 200 and `GET /ready` → 200 `{database: ok, redis: ok}` on :3000 and :3001; unknown route → 404 standard shape. Two defects found and fixed on the way (see "Defects found by the Docker run"). Host port 5432 was taken by a local Postgres, so the run used `POSTGRES_HOST_PORT=55432` (supported override, `.env` unchanged). |
| Server refuses to start with a missing required variable                                             | ☑ Passed                  | `startup.integration.spec.ts`: all three entry points exit non-zero with `DATABASE_URL: missing`; output contains neither the Redis password nor the bad URL value. Unit tests cover every required variable.                                                                                                                                                                                                                                                                            |
| CI green on a pull request, incl. gitleaks and `npm audit`                                           | ☐ **Not run**             | Workflow written (`.github/workflows/server-ci.yml`), not yet pushed. Local equivalents: `npm audit --audit-level=high` exit 0; gitleaks 8.30.1 over history (4 commits): no leaks.                                                                                                                                                                                                                                                                                                      |
| Contract drafts committed and shared with the app team                                               | ◐ Written, not shared     | `contracts/openapi.yaml` (35 operations) and `contracts/asyncapi.yaml` (14 events) validate and are unit-tested; commit and notification of the app team are pending your OK.                                                                                                                                                                                                                                                                                                            |
| Phase report submitted                                                                               | ☑ This document           |                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Required tests (brief §3):

| Test                                                                                       | Result                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config: missing `DATABASE_URL` → non-zero exit, no env values in output                    | ☑ `config.spec.ts` + `startup.integration.spec.ts` (real processes)                                                                                                                                   |
| Logger: `password`, `token`, `sdp` print `[REDACTED]`                                      | ☑ `logger.spec.ts` — every sensitive key at nesting depth 0–3, arrays, query strings, auth headers                                                                                                    |
| Errors: unknown route → 404 standard shape; generic error → 500 `internal_error`, no stack | ☑ `http-pipeline.spec.ts`                                                                                                                                                                             |
| Validation: unknown field → `400 validation_failed`                                        | ☑ `http-pipeline.spec.ts` (value never echoed)                                                                                                                                                        |
| `/ready` returns 503 when Redis is stopped (integration)                                   | ☑ `ready.integration.spec.ts` (Testcontainers Postgres 16 + Redis 7): 503 `service_unavailable` after stopping Redis, and after stopping Postgres; 200 with both up; `app_meta` exists after migrate. |

## Results

| Command                                                    | Result                                              |
| ---------------------------------------------------------- | --------------------------------------------------- |
| `npm run typecheck`                                        | pass                                                |
| `npm run lint` (type-checked rules, `no-console: error`)   | pass                                                |
| `npm run format:check`                                     | pass                                                |
| `npm test` (unit)                                          | **112 / 112 pass** (6 files)                        |
| `npm run test:integration` — `startup.integration.spec.ts` | **7 / 7 pass** (needs a build, not Docker)          |
| `npm run test:integration` — `ready.integration.spec.ts`   | **5 / 5 pass** (Docker; 12 / 12 integration total)  |
| `npm run contracts:types`                                  | deterministic (regenerating produces no diff)       |
| `npm run build`                                            | pass (ESM output in `dist/`)                        |
| `npm audit --audit-level=high`                             | exit 0 (8 moderate remain, dev-only — see Security) |
| gitleaks 8.30.1 (checksum verified), full history          | no leaks                                            |
| `docker build` / compose build (api image + migrate image) | pass                                                |

## Defects found by the Docker run (2026-11-26)

Both were invisible without Docker; both are fixed and covered by tests.

1. **`.env.example`: `CORS_ORIGINS=   # comment`.** Compose reads an empty value followed by an inline comment as the _value_ `# empty = no CORS…`, so api, realtime and worker crash-looped with `CORS_ORIGINS: invalid_format`. The comment moved to its own line (`.env.example`, local `.env`). Regression: `test/unit/env-example.spec.ts` (no inline comment after a value; no real secrets in the example).
2. **First `/ready` after startup returned 503 with a healthy Redis.** `RedisService` uses `enableOfflineQueue: false` (fail fast), so a `PING` sent while ioredis was still in its initial handshake was rejected. `RedisService.ping()` now waits (≤ 800 ms, below the 1 s readiness timeout) only while the first connection is being established; a Redis that is down (`reconnecting`/`end`) still fails immediately, so fail-closed is unchanged. Regression: `ready.integration.spec.ts` (it failed 3/5 before the fix, passes 5/5 after).

## IMPLEMENTED

- NestJS 12 + Fastify scaffold with three entry points (`main-api`, `main-realtime`, `main-worker`) sharing `CoreModule`.
- Fail-closed zod configuration; names-only error output; `.env` loaded outside production only.
- pino logger with a single redaction list; request id on every request/response/error; path-only request logging.
- Global exception filter (standard error shape + `requestId`), `ZodValidationPipe`, 64 KB body limit, CORS off unless configured.
- `GET /health`, `GET /ready` (Postgres `SELECT 1` + Redis `PING`, 1 s timeout each, 503 on failure).
- Prisma 7 with driver adapter; `prisma.config.ts`; migration `20261125000000_init` creating `app_meta`.
- Dockerfile (multi-stage, non-root, `--ignore-scripts`, HEALTHCHECK), `infra/docker-compose.yml`, local coturn template.
- OpenAPI 3.1 and AsyncAPI 3.1 drafts covering every endpoint/event of the briefs; generated `src/generated/openapi.ts`.
- GitHub Actions workflow; README, CLAUDE.md, ARCHITECTURE/RUNBOOKS stubs; briefs copied to `docs/briefs/`.

## FILES CREATED / MODIFIED

All under `Server/` except `.github/workflows/server-ci.yml`. Removed `Server/.gitkeep`. **No file in `RemoteAccessApp/` was touched.**

- Config/tooling: `package.json`, `package-lock.json`, `tsconfig*.json`, `nest-cli.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore`, `.gitattributes` (forces LF), `.dockerignore`, `.nvmrc`, `.env.example`, `vitest*.config.ts`, `prisma.config.ts`
- Source: `src/{main-*.ts, bootstrap.ts, app|realtime|worker|core.module.ts}`, `src/common/{config,errors,validation,database,redis}/*`, `src/common/{logger,logger.module,nest-logger,request-id}.ts`, `src/modules/health/*`, `src/generated/openapi.ts`
- Data: `prisma/schema.prisma`, `prisma/migrations/{migration_lock.toml,20261125000000_init/migration.sql}`
- Tests: `test/unit/{config,logger,request-id,http-pipeline,contracts}.spec.ts`, `test/integration/{startup,ready}.integration.spec.ts`, `test/integration/helpers/server-process.ts`
- Infra/docs: `Dockerfile`, `scripts/healthcheck.mjs`, `infra/docker-compose.yml`, `infra/coturn/turnserver.conf.example`, `contracts/*.yaml`, `docs/*`, `README.md`, `CLAUDE.md`

## DEPENDENCIES ADDED

Versions verified with `npm view` at the start of the phase and recorded from the lockfile.

Runtime: `@nestjs/common@12.6.1`, `@nestjs/core@12.6.1`, `@nestjs/platform-fastify@12.6.1` (framework + Fastify adapter) · `@prisma/client@7.10.1`, `@prisma/adapter-pg@7.10.1`, `pg@8.23.1` (DB) · `ioredis@6.1.0` (Redis) · `pino@10.4.0` (logs) · `zod@4.6.7` (validation/config) · `reflect-metadata@0.2.2`, `rxjs@7.8.2` (Nest peers).

Dev: `typescript@6.0.3` · `@nestjs/cli@12.0.15`, `@nestjs/testing@12.6.1` · `prisma@7.10.1` · `vitest@5.1.1` · `testcontainers@12.2.2`, `@testcontainers/postgresql@12.2.2`, `@testcontainers/redis@12.2.2` · `openapi-typescript@7.13.0` (types), `@redocly/openapi-core@2.83.0` (OpenAPI lint), `@asyncapi/parser@3.6.6` (AsyncAPI validation) · `eslint@10.15.0`, `@eslint/js@10.0.1`, `typescript-eslint@8.74.0`, `eslint-config-prettier@10.1.8`, `globals@17.14.0`, `prettier@3.10.1` · `@types/node@26.6.10`, `@types/pg@8.23.1`.

Deliberately **not** added although the plan mentioned them: `unplugin-swc` (Vitest 5 handles decorator metadata), `supertest` (Fastify `inject()` is used), `@redocly/cli` (library is enough), `pino-pretty`. Deliberately **not wired**: the Nest 12 template's optional `@nestjs/observe` telemetry service (sends data off-box; not in the plan).

`package.json` overrides: `openapi-typescript` → use the root `typescript` (its peer range stops at 5.x; verified it generates correctly under 6.0.3) · `@prisma/config` → `effect@3.22.5` (security, see below). `allowScripts`: `@scarf/scarf`, `protobufjs`, `ssh2`, `prisma`, `@prisma/engines` are **denied**; Prisma works without them.

## CONTRACT CHANGES

New: `contracts/openapi.yaml` (35 operations; only `/health` and `/ready` are `x-status: implemented`) and `contracts/asyncapi.yaml` (14 events, all planned). **The app team has not been notified yet.**

Derived from the 8 briefs and the app plan §11–12, because the "Server Architecture & Build Plan" document was not available. **Reconcile against it when provided.** Where the briefs leave a detail open I wrote `TODO(server)` instead of inventing one: block-request body, the fixed lists for end/report reasons, the export payload, the exact response bodies of the Phase 7 control endpoints.

### Mismatches between the app plan and the server briefs (for the app team)

1. App §11 lists `GET /api/devices/:deviceId`; no server brief defines it. **Not added** (rule 3).
2. The app plan does not list server endpoints: `GET /api/me`, `PATCH /api/devices/:id`, settings, blocks, `POST /api/devices/:id/pin`, `POST /api/dev/push-test`, `GET /api/account/export`, the three control endpoints.
3. **Integrity policy:** app §17.2 treats a failed verdict as a risk signal; server Phase 2 **requires** `ok` for register/login.
4. **JWT device claim:** app says `deviceId`, server uses `did` (the app must not read JWT contents anyway).
5. **TURN username:** app says `<expiry>:<userId>`; server uses `<expiry>:<sessionId>:<deviceId>` (opaque to the app).
6. **Realtime:** server adds `ping`, `webrtc:connected` and (v2) `session:control-*`; app §12 lists none of them.
7. **History items:** app mock uses `direction` and `completed`; server returns `role` and the 8 server statuses.
8. **ICE candidates:** the app's type has `sdpMid` / `sdpMLineIndex` as nullable; Phase 5's schema is optional-but-not-nullable, so a `null` would be dropped as a violation and ICE would fail. The AsyncAPI draft **proposes accepting `null`** (confirm in Phase 5).
9. **Open decision:** device public ID length (the app mock shows 9 digits).
10. **Size limit (Phase 5 trap):** Phase 3 sets the socket `maxHttpBufferSize` to 16 384 bytes while Phase 5 allows SDP up to 16 KB; a maximum-size offer plus its envelope would exceed the buffer and disconnect instead of being dropped.

## MIGRATIONS

`20261125000000_init` — creates the `app_meta` table only. Reversible by dropping the table (no data). Generated offline with `prisma migrate diff` (no Postgres was available), which yields the same SQL as `migrate dev`; it is applied to a real Postgres by `ready.integration.spec.ts` (**not yet run**) and by the compose `migrate` service (**not yet run**).

## COMMANDS EXECUTED

`npm install`, `npm run build`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npx vitest run --config vitest.integration.config.ts startup`, `npm run contracts:types`, `npm audit`, `npx prisma generate | validate | migrate diff`, gitleaks `git` scan (binary downloaded to a scratch directory, SHA-256 verified against the release checksums), a throwaway smoke script booting `dist/main-api.js` (scratchpad, not committed).

## SECURITY IMPACT

- **New secrets (name only, where stored):** none committed. Local `.env` (gitignored, random hex passwords generated locally, never printed) holds `POSTGRES_PASSWORD`, `REDIS_PASSWORD` and the two URLs derived from them. Production secrets arrive in later phases via the secrets manager.
- **New endpoints / events and their protection:** `GET /health` (no data) and `GET /ready` (returns only `ok` or a generic 503; the failing dependency is logged, not returned). Both unauthenticated by design; no other endpoint exists.
- **New stored data:** table `app_meta` (empty).
- **Logging reviewed for leaks: yes.** Verified by tests that redact every sensitive key at depth 0–3, that query strings and authorization headers never appear, and that a real process with secret-bearing URLs never logs those secrets (DB and Redis passwords, a `?ticket=` query value).
- **Rate limits added:** none (first limits arrive in Phase 2).
- **Dependency audit:** `npm audit --audit-level=high` passes. A high-severity chain (`prisma` → `@prisma/config` → `effect@3.20.0`, ReDoS in `Schema.TemplateLiteral`, GHSA-7589-6fvf-x4pw) was fixed with a scoped override to `effect@3.22.5` (patched ≥ 3.22.1; Prisma validate/generate/diff re-verified). 8 **moderate** findings remain: the dev-only Testcontainers → `archiver` → `glob`/`minimatch` chain (DoS via glob amplification; not shipped, not reachable from the server). npm's suggested "fix" is a downgrade to Testcontainers 10, which I rejected.
- **Supply chain:** dependency install scripts denied (`allowScripts`), Docker and CI use `--ignore-scripts`; GitHub Actions pinned by commit SHA; CI has `permissions: contents: read`; gitleaks comments and artifact upload disabled.
- **Config hardening:** unset `BIND_HOST` binds loopback; wildcard CORS is rejected; production requires an https public URL.
- **Template telemetry:** the Nest 12 scaffold offers an optional external observability service (`@nestjs/observe`); intentionally not installed.

## OPEN QUESTIONS / BLOCKERS

1. ~~Docker Desktop~~ — installed; compose, integration tests and image builds are done (see above).
2. **Architecture doc** not provided — contracts are derived; reconcile when it arrives.
3. **Approval to push** the branch and open a PR (CI, gitleaks run, app-team notification).
4. Local port 5432 is occupied by a native Postgres on the dev machine; use `POSTGRES_HOST_PORT=55432` for compose here. Windows-only quirk: Vitest fails when started from a shell whose cwd has a lowercase drive letter (two module instances of `vitest`). Documented in the README; Linux/CI unaffected.
5. Prisma CLI install scripts are denied; Linux CI/Docker will confirm the schema-engine binary is bundled. If not, approve `@prisma/engines` narrowly.
6. First gitleaks run in CI scans the app's history too; the local scan of the current history is clean.
7. Ordering exception: Phase 1 (TURN relay) was started before this gate passed (reason in the Phase 1 report). It shares no code with Phase 0.

## NEXT PHASE

After this gate is accepted: **Phase 2 — Accounts and Authentication** (decide first: Play Integrity classic vs standard; need the Google Cloud project, Play Console app, package name and release-cert SHA-256, or run with `INTEGRITY_MODE=bypass` locally).
