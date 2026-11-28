# Architecture (Phases 0 and 2)

> Stub. The full "MobileDesk — Server Architecture & Build Plan" is a separate shared document that was **not available** when Phase 0 was built; this file records only what exists in the code today and the decisions taken while building it (Phase 0: foundation; Phase 2: accounts and authentication). Reconcile the two when the document is provided.

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

## Accounts and authentication (Phase 2)

### Modules

| Module              | Owns                                                                                                                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `auth`              | register, login, refresh, logout, `DELETE /api/account`, the global `AuthGuard`, password hashing, access and refresh tokens |
| `users`             | `GET /api/me`, the cached "may this user act?" answer (`UserStatusService`)                                                  |
| `integrity`         | `GET /api/integrity/nonce`, the nonce store, the verdict rules and the Google client                                         |
| `audit`             | security events as structured log lines (`audit: true`); a persisted audit table comes later                                 |
| `realtime` bridge   | the hook the API uses to drop sockets (`disconnectUser`, `disconnectDevice`); a no-op until the gateway exists (Phase 3)     |
| `common/rate-limit` | the Redis fixed-window limiter, provided by `CoreModule` (global)                                                            |

Every route needs a valid access token unless it is marked `@Public()`. The guard is global and protected by default, so a new route cannot be forgotten. The worker process only runs the hourly refresh-token cleanup.

### Sign-in and token lifecycle

```text
app                                  api                                   redis / postgres
 |  GET /api/integrity/nonce  ------->|  rate limit 30/min/IP                SET integrity-nonce:{n} EX 300
 |  Play Integrity token with         |
 |  requestHash = H(action|nonce|email)
 |  POST /api/auth/login  ----------->|  limit: IP 30/15 min
 |                                    |  GETDEL nonce (single use) -> verdict (Google)
 |                                    |  limit: email 10/15 min (only requests that passed the verdict) -> argon2 verify
 |  <-- accessToken (15 min, EdDSA)   |  new refresh FAMILY, absolute expiry = now + 30 days
 |  <-- refreshToken (opaque)         |  only sha256(refreshToken) is stored
 |  POST /api/auth/refresh  --------->|  tx: advisory lock(family) + row lock; mark used; insert successor
 |  <-- new pair                      |  a token that was already used => revoke the WHOLE family
```

- **Access token:** EdDSA JWT with a `kid` header and the claims `sub`, `did` (device or null), `iss`, `aud`, `iat`, `exp`, `jti`. Verified with `algorithms: [EdDSA]` only. Several keys can be loaded at once; `JWT_ACTIVE_KID` signs.
- **Refresh token:** 32 random bytes; only the SHA-256 is stored. Rotation keeps the family's absolute expiry (refreshing never extends the 30 days). Reuse revokes the family, audits `refresh_reuse_detected` and calls the realtime hook.
- **Why an advisory lock as well as the row lock:** the row lock covers only the presented token. A reuse alarm that runs while the successor token is being refreshed can revoke the family just before the successor is inserted and leave one live token behind. This was reproduced: with the lock removed the race test fails in its first round. The per-family advisory lock orders the two.
- **The reuse branch returns instead of throwing inside the transaction.** A throw would roll the revocation back; the exception is raised after the commit.
- **Play Integrity (Standard requests):** `requestHash = base64url(SHA-256("<action>|<nonce>|<email>"))`. The nonce is consumed first and always, so replayed, expired and unknown nonces never reach Google. Checks: package name, hash, timestamp within 2 minutes, `PLAY_RECOGNIZED`, signing-certificate digest, `MEETS_DEVICE_INTEGRITY`. A bad verdict is `403 integrity_failed` with a generic message (the reasons go to the audit log); Google unreachable is `503 integrity_unavailable`.
- **Logout** revokes the family of the presented token and always answers 204. The access token itself cannot be revoked; it expires within 15 minutes.
- **Suspension** takes effect within 60 seconds (the status cache TTL). **Deletion** clears the cache entry, so it is immediate.

### Redis keys (every key has a TTL)

| Key                               | Purpose                                 | TTL                              |
| --------------------------------- | --------------------------------------- | -------------------------------- |
| `integrity-nonce:{nonce}`         | single-use Play Integrity nonce         | 5 min                            |
| `user-status:{userId}`            | `active` or `blocked` (guard cache)     | 60 s                             |
| `rl:login:ip:{ip}`                | counter, 30 per 15 min                  | 15 min                           |
| `rl:login:email:{sha256(email)}`  | counter, 10 per 15 min                  | 15 min                           |
| `rl:register:ip:{ip}`             | counter, 5 per hour                     | 1 h                              |
| `rl:refresh:family:{familyId}`    | counter, 30 per 15 min                  | 15 min                           |
| `rl:nonce:ip:{ip}`                | counter, 30 per minute                  | 1 min                            |
| `rl:account-delete:user:{userId}` | counter, 5 per 15 min (password oracle) | 15 min                           |
| `bull:maintenance:*`              | the cleanup job (worker)                | managed by BullMQ (no eviction!) |

A client is identified by `request.ip`: the socket address, or the forwarded one only when the immediate peer is a proxy listed in `TRUST_PROXY`. An IPv4-mapped IPv6 address counts as its IPv4 address, and an IPv6 client counts per /64.

### Fail closed

- **Redis down:** register, login, refresh, nonce and account deletion answer `503 service_unavailable` (the limiter cannot count). Logout still works. A signed-in request is still decided, from the database.
- **Postgres down:** everything that needs it answers `503`. The error filter maps connection errors to a retryable 503 instead of a 500: Prisma codes, socket codes, and the pg pool's plain `Connection terminated unexpectedly` (found by stopping a real Postgres under Prisma 7 with the pg adapter).

## Phase 2 decisions and deviations from the brief

| Topic                        | Decision                                                                                                                | Why                                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Play Integrity variant       | Standard requests; the nonce travels in the body as `integrityNonce`                                                    | docs/DECISIONS.md, section C                                                                                                                                                       |
| Failed verdict               | `403 integrity_failed` (new code) with a generic message                                                                | the brief only names `503 integrity_unavailable`; a distinct code lets the app say "unsupported device"                                                                            |
| Per-family advisory lock     | added to refresh and logout                                                                                             | the brief's row lock alone leaves a live token behind (reproduced)                                                                                                                 |
| Reuse branch                 | returns, then throws after the commit                                                                                   | the brief's snippet throws inside the transaction, which rolls the revocation back                                                                                                 |
| Per-email login limit        | counted AFTER the integrity check, not before                                                                           | counted before, anyone who knows an address locks that user out for 15 minutes with ten junk requests (reproduced); a password guess still needs a valid verdict and a fresh nonce |
| Refresh needs an active user | a suspended or deleted account cannot rotate                                                                            | otherwise a blocked account keeps a session alive                                                                                                                                  |
| Account deletion limit       | 5 attempts per 15 min per user                                                                                          | the endpoint checks a password, so a stolen access token would turn it into an oracle                                                                                              |
| Email of a deleted account   | stays reserved until the hard delete (Phase 6); re-registering gives `409 email_taken`                                  | the brief; revisit if abuse investigation does not need it                                                                                                                         |
| Suspended user signs in      | `403 forbidden`, only after the correct password; unknown, deleted and wrong password are one `401 invalid_credentials` | the brief is silent; avoids telling a guesser that the account exists                                                                                                              |
| Trusting a proxy             | `TRUST_PROXY`: off by default; a hop count or CIDRs; `true` and `/0` are refused                                        | a client-chosen address would defeat every per-IP limit                                                                                                                            |
| Certificate check            | at least one reported digest must be in the configured list                                                             | the brief: "contains the release signing cert digest"; several digests allow certificate rotation                                                                                  |
| IPv6 rate limiting           | per /64                                                                                                                 | one subscriber owns a whole /64 and could otherwise rotate addresses                                                                                                               |
| Audit trail                  | structured log lines with ids only                                                                                      | the brief defines no table; Phase 4 adds session events                                                                                                                            |
| Lower-cased email            | also enforced by a CHECK constraint                                                                                     | defence in depth; Prisma cannot model it, so it is written by hand in the migration                                                                                                |
| Worker connections           | BullMQ gets its own Redis connections (`maxRetriesPerRequest: null`); production Redis needs `noeviction`               | BullMQ requirements, recorded for Phase 6                                                                                                                                          |

## Not yet decided (open)

- Device public ID length: 9 or 10 digits (Phase 3).
- Fixed lists for session end reasons and report reasons (Phase 4).
- Request body for `POST /api/blocks` (Phase 4).
