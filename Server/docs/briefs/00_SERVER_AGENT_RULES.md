# MobileDesk Server — Agent Rules (read before every phase)

**Applies to:** every server phase brief (`Phase_0` … `Phase_7`).
**Architecture reference:** "MobileDesk — Server Architecture & Build Plan" (shared doc). If a brief and the architecture doc disagree, stop and ask.
**Client plan:** `MobileDesk_Execution_Plan_v2.md` (the app). Server phases unlock app milestones; keep contracts in sync.

---

## 1. Assumed stack (change only with a human decision)

| Layer | Choice |
|---|---|
| Runtime | Node.js LTS, TypeScript `strict` + `noUncheckedIndexedAccess` |
| Framework | NestJS with the Fastify adapter |
| DB / ORM | PostgreSQL 16+ with Prisma (migrations committed) |
| Cache / jobs | Redis 7 + BullMQ |
| Realtime | Socket.IO + `@socket.io/redis-adapter` |
| Validation | zod (request bodies, queries, socket payloads, config) |
| Passwords | `argon2` (Argon2id) |
| JWT | `jose`, EdDSA (Ed25519) |
| Push | `firebase-admin` |
| TURN | coturn |
| Logs / errors | pino with redaction, Sentry |
| Tests | Vitest (or Jest) + Supertest + Testcontainers (Postgres, Redis) |
| CI | GitHub Actions |
| Region | AWS `ap-south-1` (Mumbai) unless told otherwise |

Verify current stable versions at the start of each phase. Record every dependency added in the phase report.

## 2. Non-negotiable rules

1. **Inspect before changing.** Read the repo, existing modules and the contracts before writing code.
2. **Work only inside the current phase.** Do not start the next phase until this phase's gate passes and the report is accepted.
3. **Contract-first.** Change `contracts/openapi.yaml` / `contracts/asyncapi.yaml` first, then code. Generate types from them. Never invent an endpoint the app doesn't know about without updating the contract.
4. **The app is untrusted.** Every authorization decision is made on the server from the authenticated identity and database state. Never trust a user ID, device ID or session status sent by a client.
5. **No secrets in git, images or logs.** Secrets come from environment variables injected by the secrets manager (local: an uncommitted `.env`). `.env.example` contains names only. gitleaks must pass.
6. **Validate every input** with zod: reject unknown fields, enforce sizes, return `400` with the standard error shape.
7. **Standard error shape:** `{ "error": { "code": "<stable_snake_case>", "message": "<human text>" } }`. Codes are listed in `src/common/errors/codes.ts` and in the OpenAPI spec.
8. **Never log** passwords, tokens, refresh tokens, tickets, SDP, ICE candidates, TURN credentials, FCM tokens or integrity tokens. The pino redact list in `src/common/logger.ts` is the single source of truth; add to it when you add a sensitive field.
9. **Fail closed.** If a check cannot be completed (Redis down, Google unreachable, DB error), deny the action and return a retryable error. Never "allow on error".
10. **Idempotent and safe retries.** Endpoints that create things accept an `Idempotency-Key` where the brief says so. Background jobs must be safe to run twice.
11. **Every status change of a session goes through the session service** (from Phase 4). No direct `UPDATE sessions SET status`.
12. **Tests are part of the task.** Each phase lists required tests; the gate fails without them. Authorization tests are mandatory for every protected route.
13. **Keep it runnable.** `docker compose up` and `npm test` work at the end of every phase.
14. **No stealth features.** Nothing that lets a session start, continue or hide without the target owner's knowledge.
15. **Do not deploy to production** until Phase 6 says so.

## 3. Coding conventions

- One NestJS module per domain: `auth`, `users`, `devices`, `sessions`, `abuse`, `integrity`, `turn`, `push`, `audit`, `realtime`, `health`.
- Controllers are thin: validate → call service → map result. No Prisma calls in controllers.
- Services take an explicit `actor` (`{ userId, deviceId }`) for anything permission-related.
- Times stored as `timestamptz` in UTC. IDs: `uuid` internally; the 9–10 digit `public_id` only for devices.
- Config is read once through a zod-validated `ConfigService`; the process exits on invalid config.
- All Redis keys have a TTL. Key names follow the architecture doc.

## 4. Phase report format (required)

```text
PHASE:
STATUS: Complete / Blocked / Partial
GATE: Passed / Not passed — evidence (test names, commands, screenshots):

IMPLEMENTED:
- ...
FILES CREATED / MODIFIED:
- ...
DEPENDENCIES ADDED:
- name@version — purpose
CONTRACT CHANGES:
- openapi / asyncapi diffs, and whether the app team was notified
MIGRATIONS:
- name — what it changes — reversible?
COMMANDS EXECUTED:
- ...
TESTS:
- Passed / Failed / Not run (with reasons)
SECURITY IMPACT:
- New secrets (name only, where stored):
- New endpoints / events and their protection:
- New stored data (table, retention):
- Logging reviewed for leaks: yes/no
- Rate limits added:
OPEN QUESTIONS / BLOCKERS:
- ...
NEXT PHASE:
- ...
```

## 5. Phase index

| Brief | Phase | Unlocks app milestone |
|---|---|---|
| `Phase_0_Foundation.md` | Repo, local stack, CI, config, logging, contracts | Groundwork |
| `Phase_1_Test_Relay.md` | Temporary coturn for the app's risk spike | M1 |
| `Phase_2_Accounts_and_Auth.md` | Users, passwords, JWT, refresh rotation, Play Integrity | M3 |
| `Phase_3_Devices_Realtime_Push.md` | Device registry, WebSocket tickets, presence, FCM | M4 |
| `Phase_4_Sessions_and_Abuse.md` | Session state machine, consent, limits, history, audit | M5 |
| `Phase_5_Signaling_and_TURN.md` | WebRTC relay, ICE config, production coturn | M6 |
| `Phase_6_Hardening_and_Launch.md` | Infra, monitoring, backups, load and pen test | M8 / v1 launch |
| `Phase_7_Remote_Control_Support.md` | Target-only control grant (v2) | M7 |
