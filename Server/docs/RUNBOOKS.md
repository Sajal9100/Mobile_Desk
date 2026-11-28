# Runbooks (stub)

Phases 0 and 2 cover local development and the accounts/authentication operations. The remaining production runbooks are written in the phase that introduces them (TURN: Phase 5; incident response, backups and restore: Phase 6).

## Local stack

```sh
docker compose --env-file .env -f infra/docker-compose.yml up -d --build   # start everything
docker compose --env-file .env -f infra/docker-compose.yml ps               # health of each service
docker compose --env-file .env -f infra/docker-compose.yml logs -f api      # follow one service
docker compose --env-file .env -f infra/docker-compose.yml down -v          # stop and DELETE local data
```

- Services start in order: Postgres and Redis (healthy) → `migrate` (one-shot, must finish) → `api`, `realtime`, `worker`.
- If `migrate` fails, the others never start. Read its logs: `... logs migrate`.
- A port already in use on the host (often 5432): set `POSTGRES_HOST_PORT` / `REDIS_HOST_PORT` in `.env`.

## Add a database migration

1. Edit `prisma/schema.prisma`.
2. With the stack's Postgres running: `npm run prisma:migrate -- --name <what_changed>`.
3. Commit `prisma/migrations/<timestamp>_<name>/`. Migrations are forward-only; production changes follow expand → migrate → contract (Phase 6).

Without a database you can still produce the SQL: set a throwaway `DATABASE_URL` and run `npx prisma migrate diff --from-migrations prisma/migrations --to-schema=prisma/schema.prisma --script`. (Without any `DATABASE_URL` this command prints nothing and exits 0.)

## Change the API contract

1. Edit `contracts/openapi.yaml` or `contracts/asyncapi.yaml`. Quote any YAML plain scalar that contains `: ` or `,` inside `{ ... }` (an unquoted comma silently splits it).
2. `npm run contracts:types`, commit `src/generated/openapi.ts`.
3. `npm test` (contract tests), then tell the app team.

## Add a sensitive field

Add its key to `SENSITIVE_KEYS` in `src/common/logger.ts`. The redaction test then covers it at every nesting depth automatically.

## Reset local secrets

Delete `.env`, recreate it from `.env.example` with new hex passwords, then `docker compose ... down -v` (the database password is baked into the volume).

## Accounts and authentication (Phase 2)

### First run on a new machine

```sh
cp .env.example .env              # then replace every CHANGE_ME with a hex value
node scripts/gen-jwt-key.mjs      # writes JWT_PRIVATE_KEYS and JWT_ACTIVE_KID into .env; prints no key
```

`INTEGRITY_MODE=bypass` in `.env` is for local development only (the server refuses it when `NODE_ENV=production`). In bypass mode the Play Integrity token is not checked, but a valid single-use nonce is still required.

### Smoke test a running server

```sh
node scripts/smoke-auth.mjs http://127.0.0.1:3000
```

Registers a throwaway user and walks the whole flow (login, refresh, reuse detection, logout, deletion). It prints status codes only. Registration is limited to 5 per hour per IP, so do not loop it.

### Rotate the JWT signing key

Access tokens live 15 minutes, so a key can be replaced without logging anyone out:

1. Create a new Ed25519 key (PKCS#8 PEM) and add it to `JWT_PRIVATE_KEYS` under a new `kid`, keeping the old one. Roll out. Every instance can now verify both.
2. Set `JWT_ACTIVE_KID` to the new `kid`. Roll out. New tokens are signed with the new key; old tokens still verify.
3. After at least 15 minutes (the access-token lifetime) remove the old key from `JWT_PRIVATE_KEYS`. Roll out.

Step 1 must reach **every** instance before step 2, otherwise an instance that signs with the new key produces tokens the others reject. Locally you can rehearse it: `node scripts/gen-jwt-key.mjs --add --kid dev-2` adds a key and makes it active. A key that leaked is different: remove it at once and accept that its tokens stop working (users refresh and carry on, because refresh tokens are independent of the signing key).

### Suspend a user, or end a user's sessions (manual, until the audited scripts of Phase 6)

```sql
-- the user may no longer act (effective within 60 s; see the Redis step for "now")
UPDATE users SET status = 'suspended' WHERE id = '<user id>';
-- end every session: no refresh token of this user works any more
UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = '<user id>' AND revoked_at IS NULL;
```

```sh
redis-cli DEL user-status:<user id>      # makes the suspension immediate instead of within 60 s
```

Access tokens that were already issued stay valid for at most 15 minutes, except that the guard refuses a suspended user within 60 seconds. Record who did it and why.

### A legitimate user is rate limited

Limits are Redis counters that expire by themselves (login 15 min, register 1 h). To lift one early:

```sh
redis-cli DEL rl:login:email:$(printf '%s' 'user@example.com' | sha256sum | cut -d' ' -f1)
redis-cli --scan --pattern 'rl:login:ip:*'          # find an IP key; then DEL it
```

The email key holds a SHA-256 of the lower-cased address, never the address.

### Read the audit trail

Audit events are log lines with `"audit":true` and an `event` field: `login_failed` (with a `reason`), `integrity_failed` (with the `reasons`), `refresh_reuse_detected`, `account_deleted`. They carry ids only: no email, no token. A burst of `refresh_reuse_detected` means tokens are being stolen or an app bug refreshes twice; a burst of `integrity_failed` with `wrong_certificate` or `wrong_package` means a repackaged app. (Alerts on both come with Phase 6.)

### Play Integrity setup checklist (only needed for `INTEGRITY_MODE=enforce`)

See docs/DECISIONS.md, section C, for the why. In short: the Play Console app and its final package name (permanent after the first upload), the Play Integrity API enabled in a Google Cloud project that is linked in the Play Console, a service account with a JSON key (`GOOGLE_SERVICE_ACCOUNT_JSON`), the **app signing key** SHA-256 from the Play Console (`INTEGRITY_CERT_SHA256`, not the upload key), and `INTEGRITY_PACKAGE_NAME`. Test on a phone with the build installed from Play; sideloaded debug builds and most emulators fail the verdict, so use `bypass` for those. Check the Play Integrity daily request quota before launch.

### Redis for the worker

The worker's BullMQ queue (`bull:maintenance:*`) requires Redis with `maxmemory-policy noeviction`; with an evicting policy Redis may drop queue data. The local compose Redis has no memory limit, so this only matters for ElastiCache in Phase 6.
