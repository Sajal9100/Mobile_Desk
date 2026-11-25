# Runbooks (stub)

Phase 0 covers local development only. Production runbooks are written in the phase that introduces them (key rotation: Phase 2; TURN: Phase 5; incident response, backups and restore: Phase 6).

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
