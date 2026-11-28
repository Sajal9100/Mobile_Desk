# Phase 2 report — Accounts and authentication

```text
PHASE: 2 — Accounts and Authentication
STATUS: Partial — the server side is built and verified locally (2026-11-28). Three things cannot be
        done from this machine: the CI run (the branch is not pushed), the app's real login (the app
        is still on mock data, and `RemoteAccessApp/` was not touched) and a real Play Integrity
        verdict (no Play Console app, no Google Cloud project, no phone).
GATE: Not passed yet — 2 of 5 items passed, 3 are waiting on you (table below).
```

Branch `server/phase-2-accounts-auth`, based on `origin/server/phase-0-foundation` because PR #3 (Phase 0 close-out: `DECISIONS.md`, the redaction spec) is still open. Retarget the PR to `main` once #3 merges. Nothing was pushed.

## Gate checklist (brief §8)

| Gate item                                                                   | State                   | Evidence / what is missing                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App login, refresh and logout work against staging (or local with `bypass`) | ◐ **Local, `bypass`**   | **Recorded mode: local Docker stack, `INTEGRITY_MODE=bypass`** (no staging exists, no Play setup yet). `scripts/smoke-auth.mjs` passes 22/22 against the rebuilt compose stack (register, duplicate, login, wrong password, refresh, reuse detected, family revoked, logout, deletion, token dead at once). The app itself has not been run against it: its screens still use mock data (M3 wiring is yours). |
| All tests in §7 pass in CI                                                  | ◐ **Local only**        | All pass locally: 348 unit + 141 integration (Docker). The branch is not pushed, so CI has not run. The Linux build was exercised through the Docker image build (node:26-slim), which loads `argon2` and runs the full flow.                                                                                                                                                                                 |
| JWT signing keys and Google credentials come from config/secrets only       | ☑ **Passed**            | Both are zod-validated environment variables (`JWT_PRIVATE_KEYS`, `GOOGLE_SERVICE_ACCOUNT_JSON`); config tests; test keys are generated at run time; no PEM in git; gitleaks over the full history: 16 commits, no leaks.                                                                                                                                                                                     |
| OpenAPI updated; app team notified                                          | ◐ **Updated, not sent** | `contracts/openapi.yaml` 0.2.0 and the regenerated types are committed; `contracts:check` passes. The hand-over text for the app is `docs/DECISIONS.md` §E ("What the app has to do"). Notification = the PR once pushed.                                                                                                                                                                                     |
| Phase report with SECURITY IMPACT submitted                                 | ☑ **Passed**            | This document.                                                                                                                                                                                                                                                                                                                                                                                                |

## Required tests (brief §7)

| Required test                                                                                                              | Where                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password policy; email normalisation                                                                                       | `test/unit/auth-schemas.spec.ts`                                                                                                                                              |
| JWT: valid passes; `alg: none`, HS256 with the public key as secret, wrong `aud`, wrong `iss`, expired, unknown `kid` fail | `test/unit/access-token.spec.ts` (also: tampered payload, foreign signature, no `kid`, missing `jti`, key rotation)                                                           |
| Register → login → `/api/me`                                                                                               | `auth.integration.spec.ts`                                                                                                                                                    |
| Wrong password and unknown email: identical body                                                                           | `auth.integration.spec.ts` (+ a spy that the dummy hash is verified, + a loose timing ratio)                                                                                  |
| Refresh rotates; old token reused → `refresh_reuse_detected` **and** the new token is revoked                              | `refresh.integration.spec.ts`                                                                                                                                                 |
| Logout revokes the family; refresh after logout fails                                                                      | `refresh.integration.spec.ts`                                                                                                                                                 |
| Suspended user's valid access token rejected within 60 s                                                                   | `auth.integration.spec.ts` (cache TTL asserted ≤ 60, then expired)                                                                                                            |
| Rate limit → 429 with `Retry-After`                                                                                        | `rate-limit.integration.spec.ts` (login email and IP, register, nonce, refresh; also IPv6 and `X-Forwarded-For`)                                                              |
| Integrity: missing / wrong package / replayed nonce / old timestamp rejected (Google mocked)                               | `integrity.integration.spec.ts` (+ wrong cert, no device integrity, wrong hash, Google down, no oracle)                                                                       |
| Account deletion revokes all families and blocks login                                                                     | `account.integration.spec.ts`                                                                                                                                                 |
| No response or log line contains the raw refresh token                                                                     | `test/security/token-leak.integration.spec.ts` (trace-level capture; also passwords, access tokens, nonces, integrity tokens, emails, hashes, keys; Postgres and Redis dumps) |

Added beyond the brief: the reuse-vs-refresh race (`refresh.integration.spec.ts`), fail-closed with Redis or Postgres actually stopped (`fail-closed.integration.spec.ts`), the BullMQ cleanup job (`cleanup.integration.spec.ts`), proxy trust (`trust-proxy.spec.ts`), outage classification (`dependency-errors.spec.ts`), config refusals (`config.spec.ts`, and real processes in `startup.integration.spec.ts`: `bypass` is refused in production by all three entry points and a bad key is never printed).

Three tests were **mutation-checked**: I broke the code on purpose and confirmed the test fails, then restored it.

| Mutation                                                   | Result                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------- |
| Remove the per-family advisory lock from refresh           | race test fails in round 0: a live token is left in a revoked family |
| Log a raw refresh token under an unredacted key            | the leak test fails and names the token                              |
| Count the per-email login limit before the integrity check | the lockout test fails at junk request 11 (429 instead of 403)       |

## Results

| Command                                                            | Result                                                                                                            |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck` / `lint` / `format:check`                      | pass                                                                                                              |
| `npm run contracts:check`                                          | pass (types regenerate identically)                                                                               |
| `npm test` (unit, no Docker)                                       | **348 / 348** (14 files)                                                                                          |
| `npm run test:integration` (build, Testcontainers, real processes) | **141 / 141** (10 files, about 2 minutes)                                                                         |
| `docker compose up -d --build`, then `scripts/smoke-auth.mjs`      | 5 services up, migration applied, **22 / 22** steps                                                               |
| `npm audit --audit-level=high` / `--omit=dev`                      | exit 0 / **0 vulnerabilities** in what ships (8 moderate remain, dev-only: the Testcontainers chain from Phase 0) |
| gitleaks 8.30.1 (pinned image), full history                       | 16 commits, **no leaks** (see "Found on the way", item 5)                                                         |
| Argon2id (m=19456, t=2, p=1) inside the production image           | median 67 ms, worst of 10: 198 ms (target ≤ 250 ms); 48 ms on the Windows host                                    |
| Container logs after the smoke run                                 | no token, key, email or password-like text; audit lines carry ids only                                            |

## IMPLEMENTED

- **Data:** `users`, `refresh_tokens`, `user_settings` (Prisma models and migration); emails stored lower-cased and trimmed, also enforced by a CHECK constraint.
- **Endpoints (all in `openapi.yaml`, `x-status: implemented`):** `GET /api/integrity/nonce`, `POST /api/auth/register|login|refresh|logout`, `DELETE /api/account`, `GET /api/me`.
- **Passwords:** Argon2id with the OWASP baseline; unknown and deleted emails still run a verification against a dummy hash made with the current parameters; re-hash on login when parameters change.
- **Access tokens:** EdDSA JWT (15 min, `kid`, `sub`, `did`, `iss`, `aud`, `iat`, `exp`, `jti`); verification pins `EdDSA`, issuer, audience, 30 s tolerance; several keys can be loaded, so rotation needs no downtime.
- **Refresh tokens:** random, only the SHA-256 stored, 30-day absolute family expiry kept across rotations, reuse detection that revokes the family, per-family rate limit, hourly cleanup of rows expired more than 7 days ago (BullMQ job in the worker).
- **Play Integrity (Standard requests):** nonce store, `requestHash` recipe with two published test vectors, the six checks of the brief, the Google client behind an interface (mocked in every test), `bypass` that still needs a valid nonce and that the server refuses in production.
- **Guard:** global `AuthGuard`, protected by default, `@Public()` to opt out; checks the user is active and not deleted through a 60-second Redis cache.
- **Rate limits** (Redis, fixed window, every key has a TTL): login 30 per 15 min per IP and 10 per 15 min per email, register 5 per hour per IP, refresh 30 per 15 min per family, nonce 30 per minute per IP, plus 5 per 15 min per user on account deletion.
- **Config:** `JWT_PRIVATE_KEYS`, `JWT_ACTIVE_KID`, `INTEGRITY_MODE`, `INTEGRITY_PACKAGE_NAME`, `INTEGRITY_CERT_SHA256`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `TRUST_PROXY`, all validated at startup with names-only error output.
- **Operations:** `scripts/gen-jwt-key.mjs` (local signing key, also a rotation rehearsal), `scripts/smoke-auth.mjs`, runbooks for key rotation, suspension, lifting a limit and the Play setup.

## Found on the way (differences from the brief, each with evidence)

1. **The brief's refresh transaction leaves a live token behind.** The row lock covers only the presented token. A reuse alarm racing the refresh of the successor can revoke the family just before the successor is inserted. Reproduced (see the mutation table); fixed with a per-family advisory lock, also taken by logout.
2. **The brief's pseudo-code throws inside the transaction on reuse,** which rolls the revocation back, so the alarm would revoke nothing. The code returns from the transaction and throws after the commit.
3. **A database outage was a 500, not a retryable 503.** Prisma 7 with the pg adapter reports a Postgres that was reachable and then went away as a plain `Error("Connection terminated unexpectedly")` or a socket code (`ECONNREFUSED`, also in an `AggregateError`), not a `P1xxx` code. The error filter now classifies these. Found by stopping a real Postgres; the classification is unit-tested with negative controls (a unique-constraint error stays a 500).
4. **The per-email login limit allowed a lockout.** Counted before the integrity check, ten junk requests from anyone lock an address for 15 minutes. It is now counted after the check (decision E8); a password guess still needs a valid verdict and a fresh nonce.
5. **A gitleaks false positive** (`generic-api-key` on the line that builds the `.env` entry in `gen-jwt-key.mjs`) would have failed the CI secret scan. I restructured the code and folded the fix into the commit that introduced it, which **rewrote my five unpushed local commits** (nothing had been pushed; the resulting tree was checked identical apart from that fix).
6. **`Server/src/common/guards/.gitkeep` was removed** (the folder now holds real files). The test Postgres password is now long and unusual, because the Testcontainers default (`test`) also appears as the `service` field of every log line and made the leak test meaningless.

## FILES CREATED / MODIFIED

All under `Server/`. **No file in `RemoteAccessApp/` was touched.** Local, untracked `.env` (gitignored) got `JWT_PRIVATE_KEYS`, `JWT_ACTIVE_KID` and `INTEGRITY_MODE=bypass` from `gen-jwt-key.mjs`; the key was never printed.

- Contract: `contracts/openapi.yaml`, `src/generated/openapi.ts`
- Data: `prisma/schema.prisma`, `prisma/migrations/20261128000000_accounts_auth/migration.sql`
- Config and plumbing: `src/common/config/{config.schema,load-config}.ts`, `src/bootstrap.ts`, `src/core.module.ts`, `src/common/logger.ts`, `src/common/errors/{codes,app.exception,all-exceptions.filter}.ts`, `src/common/{crypto,with-timeout}.ts`, `src/common/http/client-ip.ts`, `src/common/guards/actor.ts`, `src/common/rate-limit/rate-limit.service.ts`, `.env.example`, `infra/docker-compose.yml`
- Modules: `src/modules/auth/*` (12 files), `src/modules/users/*` (4), `src/modules/integrity/*` (6), `src/modules/audit/*` (2), `src/modules/realtime/*` (2), `src/app.module.ts`, `src/worker.module.ts`, `src/modules/health/{health.controller,readiness.service}.ts`
- Scripts: `scripts/gen-jwt-key.mjs`, `scripts/smoke-auth.mjs`
- Tests: 7 new unit spec files, 7 new integration spec files, `test/security/token-leak.integration.spec.ts`, `test/helpers/test-config.ts`, `test/integration/helpers/{stack,client}.ts`, updated `config`, `contracts`, `ready`, `startup` specs and both Vitest configs
- Docs: `README.md`, `CLAUDE.md`, `docs/{ARCHITECTURE,RUNBOOKS,DECISIONS}.md`, this report

## DEPENDENCIES ADDED

Versions from `npm view` on 2026-11-27 and read back from the lockfile.

- `argon2@0.45.2` — Argon2id. Native, but the package ships prebuilt binaries (linux x64/arm64 glibc and musl, win32 x64, darwin arm64), so it works with `--ignore-scripts`
- `jose@6.2.18` — EdDSA JWT signing and verification
- `bullmq@6.7.10` — worker queue (uses the existing `ioredis@6.1.0` as its peer)
- `google-auth-library@11.3.4` — service-account OAuth for the Play Integrity call (the call itself is a plain `fetch`; no `googleapis` package)

37 new packages entered the lockfile in total, these four included (several are the per-platform binaries of `msgpackr-extract`); no install script is allowed to run. `allowScripts` now also denies `argon2` and `msgpackr-extract`; both work without their scripts. `bullmq` pulls in the deprecated `node-abort-controller` (harmless; Node has `AbortController`).

## CONTRACT CHANGES

`contracts/openapi.yaml` 0.1.0-draft → **0.2.0**: seven operations `planned` → `implemented`; six error codes added (`email_taken`, `invalid_credentials`, `invalid_refresh_token`, `refresh_reuse_detected`, `integrity_failed`, `integrity_unavailable`); `integrityNonce` required on register and login; `IntegrityToken` documents the `requestHash` recipe with test vectors; `403` on register/login and `429` on account deletion; size patterns on tokens and nonces. AsyncAPI unchanged. **App team: not yet notified**; `docs/DECISIONS.md` §E lists the four things the app must do (new nonce for every attempt, sign out after any 401 from refresh, refresh only on `unauthorized`, keep refresh single-flight).

## MIGRATIONS

`20261128000000_accounts_auth` — creates enum `user_status` and tables `users`, `refresh_tokens`, `user_settings` with indexes, foreign keys (`ON DELETE CASCADE`, for the Phase 6 hard delete) and the hand-written CHECK `users_email_normalised`. Reversible by dropping the three tables and the enum (no data exists anywhere yet). Generated offline with `prisma migrate diff`; applied to a real Postgres by every integration test and by the compose `migrate` service.

## COMMANDS EXECUTED

`npm install --ignore-scripts` (four packages), `npm run typecheck | lint | format:check | contracts:types | contracts:check | build | test | test:integration`, `npx prisma migrate diff | generate | validate`, `docker compose --env-file .env -f infra/docker-compose.yml up -d --build | ps | logs | down` (with `POSTGRES_HOST_PORT=55432`, because a native Postgres holds 5432), `node scripts/gen-jwt-key.mjs`, `node scripts/smoke-auth.mjs`, `docker exec ... node -e` (Argon2 timing), `npm audit`, gitleaks via its pinned image, `git rebase --autosquash` on my own unpushed commits. Throwaway probes for Prisma's outage errors were deleted. The containers of another project on this machine (`lab-portal-offline-*`) were not touched.

## SECURITY IMPACT

- **New secrets (name only, where stored):** `JWT_PRIVATE_KEYS` (Ed25519 signing keys by `kid`) and `GOOGLE_SERVICE_ACCOUNT_JSON` (Play Integrity service account). Today: environment variables, local `.env` (gitignored). Production: the secrets manager (Phase 6). Non-secret config: `JWT_ACTIVE_KID`, `INTEGRITY_MODE`, `INTEGRITY_PACKAGE_NAME`, `INTEGRITY_CERT_SHA256`, `TRUST_PROXY`.
- **New endpoints and their protection:**
  - public, by design: `GET /api/integrity/nonce` (30/min/IP), `POST /api/auth/register` (5/h/IP, valid verdict), `POST /api/auth/login` (30 per 15 min per IP, 10 per 15 min per email, valid verdict), `POST /api/auth/refresh` (the refresh token is the credential; 30 per 15 min per family), `POST /api/auth/logout` (the refresh token is the credential; always 204);
  - protected by the global guard: `GET /api/me`, `DELETE /api/account` (password re-entry, 5 attempts per 15 min per user).
  - Every other route is protected by default; `/health` and `/ready` are explicitly public.
- **New stored data:**
  - `users`: email, Argon2id hash, display name, status, `deleted_at`. Soft delete now, the row and email stay until the Phase 6 hard delete (30 days).
  - `refresh_tokens`: SHA-256 of the token, family, expiry. Deleted 7 days after the family expires (hourly job).
  - `user_settings`: three booleans.
  - Redis, all with a TTL: nonces (5 min), user status (60 s), rate-limit counters (1 min to 1 h; the email limit is keyed by a SHA-256, never the address).
  - Audit events: log lines with ids only, retention is the log retention.
- **Logging reviewed for leaks: yes.** The redaction list gained `email`, `passwordHash`, `tokenHash`, `nonce`, `integrityNonce`, `privateKey`, `private_key`, `JWT_PRIVATE_KEYS`, `GOOGLE_SERVICE_ACCOUNT_JSON`; `test/security/token-leak.integration.spec.ts` runs the whole lifecycle at trace level and finds none of 15+ secrets in logs, later responses, Postgres or Redis; the container logs of the smoke run were scanned too.
- **Rate limits added:** the six above. Fail closed: when Redis cannot count, the action is denied with a retryable 503.
- **Trust boundaries:** the client IP is the socket address unless `TRUST_PROXY` names the proxies (a hop count or CIDRs; `true` and `/0` are refused). IPv6 clients are limited per /64.
- **Known limits of the design (not bugs):** an access token cannot be revoked and lives up to 15 minutes (a suspension is enforced within 60 s by the guard); a brute-forced email still locks that account's login for 15 minutes once ten attested attempts have been made; `INTEGRITY_MODE=bypass` removes the device check entirely and is for local development only.

## OPEN QUESTIONS / BLOCKERS

1. **Not verified, needs you:** a real Play Integrity call. The server reads Google's documented fields and treats anything unexpected as `503 integrity_unavailable` (safe, but it would block everyone), so the first real token may need a small schema tweak. Needs: the Play Console app with its **final package name** (`com.remoteaccessapp` is a placeholder and becomes permanent at the first upload), the Cloud project and service account, the app-signing certificate digest, and a phone with the build installed from Play (checklist in `docs/RUNBOOKS.md`).
2. **Decision E4:** the email of a deleted account stays reserved until the Phase 6 hard delete (`409 email_taken` for up to 30 days). Say if you prefer to free it at deletion; it is a small change in `AccountService`.
3. **CI has not run.** Push when you are ready; the workflow needs no change (the integration step now also picks up `test/security/*.integration.spec.ts`). Order: merge PR #3 first, then retarget this branch to `main`.
4. **App wiring (M3):** the contract changes in §E ("What the app has to do") are the app's checklist. I did not touch `RemoteAccessApp/`.
5. **Timing equality** of "unknown email" and "wrong password" is covered by a spy (the dummy hash goes through the same `verify`) and a loose ratio test, not by a statistical timing analysis.
6. **Not measured:** many concurrent logins (Argon2 uses the libuv thread pool, 4 threads by default) and a multi-instance API; Phase 6 load test. `TRUST_PROXY` behind a real load balancer is untested (no AWS account).
7. **Redis in production must run with `maxmemory-policy noeviction`** because of BullMQ (noted in the runbook for Phase 6).

## NEXT PHASE

Phase 3 (devices, realtime, push) once this gate is accepted. It builds on three things from this phase: the device-bound refresh family (`refresh_tokens.device_id` is already nullable), the realtime hook (`RealtimeService.disconnectUser | disconnectDevice`, called today by logout, reuse detection and account deletion) and the `did` claim of the access token. Phase 3's open decisions are unchanged (public ID length: 9 recommended in `DECISIONS.md`).
