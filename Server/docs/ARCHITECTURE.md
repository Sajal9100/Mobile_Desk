# Architecture (Phase 0 stub)

> Stub. The full "MobileDesk — Server Architecture & Build Plan" is a separate shared document that was **not available** when Phase 0 was built; this file records only what exists in the code today and the decisions taken while building it. Reconcile the two when the document is provided.

## Processes

```text
            ┌────────────┐   ┌──────────────┐   ┌────────────┐
 app ──────▶│  api       │   │  realtime    │   │  worker    │
 (HTTPS)    │ main-api   │   │ main-realtime│   │ main-worker│
            └─────┬──────┘   └──────┬───────┘   └─────┬──────┘
                  └────────┬────────┴──────────────────┘
                     CoreModule: config · logger · Prisma · Redis · error filter
                           │                         │
                      PostgreSQL 16              Redis 7
```

One Docker image, three commands. Only the realtime process will hold sockets (Phase 3); the API and worker reach them through Redis (`@socket.io/redis-emitter`).

## Request pipeline (HTTP processes)

1. Fastify generates the request id (`genReqId`): a well-formed incoming `x-request-id` is kept, anything else is replaced by a UUID. It is echoed on every response (`onSend` hook) and appears in every log line and error body.
2. Body limit 64 KB (`413 payload_too_large` above that).
3. Route handler. Inputs are validated with `ZodValidationPipe` and **strict** schemas (unknown keys → `400 validation_failed`).
4. Any exception reaches `AllExceptionsFilter`, which always answers `{ error: { code, message, requestId } }` with a fixed message per code. Unknown errors become `500 internal_error`; the stack is logged, never returned.

## Configuration

`process.env` → `loadConfigOrExit()` (zod) → `setRuntimeConfig()` → `ConfigService`. Invalid config ends the process with exit code 1 and a message that names variables and problem codes only. `.env` is read only outside production.

## Logging

pino, JSON, one instance per process. `SENSITIVE_KEYS` in `src/common/logger.ts` is the single source of truth for redaction; it is expanded to paths at nesting depth 0–3 because pino's `*` matches one level only. Request logs contain the method and the **path without the query string**. Health and readiness probes are not logged.

## Readiness

`GET /ready` runs `SELECT 1` and Redis `PING`, each with a 1 s timeout; either failing returns `503 service_unavailable` (the failing dependency is logged, not returned). Prisma connects lazily and Redis uses `enableOfflineQueue: false`, so a process starts and reports "not ready" while a dependency is down, and a Redis command issued during an outage rejects immediately instead of queueing (fail closed).

## Phase 0 decisions and deviations from the briefs

| Topic                     | Decision                                                    | Why                                                                                                                  |
| ------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Module system             | ESM (`"type": "module"`, NodeNext)                          | NestJS 12 is ESM-only.                                                                                               |
| TypeScript                | 6.0.3, not 7.x                                              | `typescript-eslint` supports `<6.1`; same version as the app.                                                        |
| Prisma                    | 7.10.1 (CLI, client, adapter)                               | npm `latest` for the CLI is an 8.0 release candidate.                                                                |
| Vitest transform          | Vitest 5 on Vite 8                                          | Handles decorator metadata natively; `unplugin-swc` is not needed.                                                   |
| Tests for HTTP            | `app.inject()` (Fastify) instead of Supertest               | No socket needed; same coverage.                                                                                     |
| Extra config var          | `BIND_HOST` (default `127.0.0.1`)                           | Containers need `0.0.0.0`; the safe default is loopback.                                                             |
| Extra error code          | `payload_too_large` (413)                                   | The brief's body limit needs a distinct, stable code.                                                                |
| `requestId` in error body | added to the standard shape                                 | Lets a user report an error that can be found in logs.                                                               |
| `effect` override         | `@prisma/config` → `effect@3.22.5`                          | Clears a high-severity ReDoS advisory (GHSA-7589-6fvf-x4pw) pinned by Prisma 7.10.1. Remove when Prisma ships a fix. |
| Install scripts           | denied via `allowScripts`; Docker/CI use `--ignore-scripts` | Supply-chain hardening; Prisma works without them.                                                                   |
| CI location               | repository root `.github/workflows/server-ci.yml`           | GitHub only reads workflows there.                                                                                   |
| Phase order               | Phase 1 (TURN) runs alongside Phase 0                       | The app's spike needs it and a NO-GO would change the architecture.                                                  |

## Not yet decided (open)

- Device public ID length: 9 or 10 digits (Phase 3).
- Play Integrity mode: classic (nonce) or standard (request hash) (Phase 2).
- Fixed lists for session end reasons and report reasons (Phase 4).
- Request body for `POST /api/blocks` (Phase 4).
