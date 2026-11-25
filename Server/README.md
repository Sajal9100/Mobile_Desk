# MobileDesk Server

Backend for the MobileDesk Android app (`../RemoteAccessApp`): REST API, Socket.IO realtime and a BullMQ worker, on Node.js + NestJS (Fastify) + PostgreSQL + Redis.

> **Status: Phase 0 (foundation).** The server builds, runs, refuses bad config, logs safely, and has CI and draft contracts. There are no business endpoints yet beyond `GET /health` and `GET /ready`. See [`docs/phase-reports/`](docs/phase-reports/).

The build is split into phases with a gate each. Read [`docs/briefs/00_SERVER_AGENT_RULES.md`](docs/briefs/00_SERVER_AGENT_RULES.md) and the current phase brief before changing anything.

## Processes

| Process  | Entry point            | Listens on      | Purpose                             |
| -------- | ---------------------- | --------------- | ----------------------------------- |
| api      | `src/main-api.ts`      | `PORT_API`      | REST API                            |
| realtime | `src/main-realtime.ts` | `PORT_REALTIME` | Socket.IO (starts empty; Phase 3)   |
| worker   | `src/main-worker.ts`   | nothing         | BullMQ jobs (starts empty; Phase 2) |

All three share one image and one `CoreModule` (config, logger, Postgres, Redis, global error filter).

## Prerequisites

- **Node.js 26** (LTS, see `.nvmrc`) and npm 11
- **Docker Desktop** (WSL 2 backend on Windows) for the local stack and for the integration tests (Testcontainers)

## Quick start

```sh
npm ci --ignore-scripts          # lockfile only; no dependency may run install scripts
cp .env.example .env             # then replace every CHANGE_ME (use hex: values go into URLs)
npm run prisma:generate
npm run typecheck && npm run lint && npm test
```

### Run the whole stack in Docker

```sh
docker compose --env-file .env -f infra/docker-compose.yml up -d --build
curl http://127.0.0.1:3000/health      # {"status":"ok"}
curl http://127.0.0.1:3000/ready       # 200 when Postgres and Redis answer, 503 otherwise
curl http://127.0.0.1:3001/ready       # the realtime process
docker compose --env-file .env -f infra/docker-compose.yml down        # keep data
docker compose --env-file .env -f infra/docker-compose.yml down -v     # also delete the database
```

Postgres (`5432`) and Redis (`6379`) are published on `127.0.0.1` only. Optional local TURN: copy `infra/coturn/turnserver.conf.example` to `infra/coturn/turnserver.conf`, set the secret, then add `--profile turn`.

### Run a process on the host

Start Postgres and Redis (`docker compose ... up -d postgres redis migrate`), then:

```sh
npm run dev:api        # nest start --watch
npm run dev:realtime
npm run dev:worker
```

`.env` is loaded automatically outside production. In production the environment comes from the secrets manager and `.env` is never read.

## Scripts

| Script                                    | What it does                                                                                      |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dev:api` / `dev:realtime` / `dev:worker` | Watch mode for one process                                                                        |
| `build`                                   | `prisma generate` then `nest build` → `dist/`                                                     |
| `typecheck`                               | `tsc --noEmit` over `src`, `test` and config files                                                |
| `lint` / `format` / `format:check`        | ESLint (typescript-eslint, type-checked) / Prettier                                               |
| `test`                                    | Unit tests (no network, no Docker)                                                                |
| `test:integration`                        | Builds, then runs Testcontainers (Postgres 16, Redis 7) and real-process tests. **Needs Docker.** |
| `prisma:migrate` / `prisma:deploy`        | `migrate dev` (creates migrations) / `migrate deploy` (applies them)                              |
| `contracts:types`                         | Regenerate `src/generated/openapi.ts` from `contracts/openapi.yaml`                               |
| `contracts:check`                         | Same, then fail if the committed file changed (CI runs this)                                      |

## Configuration

Every variable is validated by a zod schema at startup ([`src/common/config/config.schema.ts`](src/common/config/config.schema.ts)). If one is missing or invalid the process exits non-zero and prints **names and problem codes only, never values**. `.env.example` lists them all.

| Variable                    | Required | Notes                                                                   |
| --------------------------- | -------- | ----------------------------------------------------------------------- |
| `NODE_ENV`                  | yes      | `development` \| `test` \| `production`                                 |
| `PORT_API`, `PORT_REALTIME` | yes      | 1–65535                                                                 |
| `DATABASE_URL`, `REDIS_URL` | yes      | `postgres(ql)://`, `redis(s)://`                                        |
| `APP_PUBLIC_BASE_URL`       | yes      | must be `https` in production                                           |
| `BIND_HOST`                 | no       | default `127.0.0.1`; containers use `0.0.0.0`                           |
| `LOG_LEVEL`                 | no       | default `info`                                                          |
| `CORS_ORIGINS`              | no       | empty = no CORS (mobile-only). Comma-separated origins; `*` is rejected |

## Contracts

[`contracts/openapi.yaml`](contracts/openapi.yaml) (REST) and [`contracts/asyncapi.yaml`](contracts/asyncapi.yaml) (Socket.IO) are the source of truth shared with the app. **Change the contract first, then the code** (rule 3). Operations are marked `x-status: implemented | planned` and `x-phase`. Unit tests check that both files are valid, list every endpoint/event of the briefs, and that `ErrorCode` matches `src/common/errors/codes.ts`.

## Security conventions (short)

- The app is untrusted: authorisation is decided on the server from the authenticated identity.
- No secrets in git, images or logs. `src/common/logger.ts` holds the one redaction list; add a key there whenever you add a sensitive field.
- Validate every input with zod (`z.strictObject`, via `ZodValidationPipe`); bodies are limited to 64 KB.
- Errors always look like `{ "error": { "code", "message", "requestId" } }`; unknown errors are a bare 500 with no stack.
- Fail closed: if a check cannot complete (Redis down, Google unreachable), deny and return a retryable error.

## Troubleshooting

- **Vitest: `Cannot read properties of undefined (reading 'config')` (Windows).** Run from a terminal whose current directory uses an **uppercase** drive letter (`C:\...`). A lowercase `c:\...` makes Node load `vitest` twice under two spellings of the same path. VS Code's integrated terminal and PowerShell normally use the uppercase form; some Git Bash `cd /c/...` sequences do not. This does not affect Linux, CI or Docker.
- **`prisma migrate diff` prints nothing and exits 0.** The schema engine needs a datasource even for an offline diff; set a dummy `DATABASE_URL` for that one command.
- **`npm install` says "install scripts not covered by allowScripts".** Intended: scripts are denied in `package.json` (`allowScripts`). Nothing here needs them.
- **gitleaks in CI.** Free for personal-account repositories. If the repo moves to a GitHub organization, add a `GITLEAKS_LICENSE` secret (see the workflow).

## Layout

```text
contracts/      openapi.yaml, asyncapi.yaml                (shared with the app)
src/            main-*.ts, *.module.ts, common/, modules/  (generated/ = Prisma + OpenAPI types)
prisma/         schema.prisma, migrations/
test/           unit/, integration/, security/
infra/          docker-compose.yml, coturn/
docs/           briefs/, phase-reports/, ARCHITECTURE.md, RUNBOOKS.md
scripts/        healthcheck.mjs (container HEALTHCHECK)
```

CI lives at the repository root: [`../.github/workflows/server-ci.yml`](../.github/workflows/server-ci.yml) (GitHub only reads workflows there).
