# MobileDesk Server - working notes for coding agents

**Before any work, read** `docs/briefs/00_SERVER_AGENT_RULES.md` and the brief of the current phase (`docs/briefs/Phase_N_*.md`). If a brief and the architecture doc disagree, stop and ask.

- **Current phase:** 2 (accounts and authentication) is built on branch `server/phase-2-accounts-auth` and awaits its gate (report: `docs/phase-reports/phase-2-accounts-auth.md`). Phase 0 is accepted. Phase 1 (throwaway TURN relay) is postponed until an AWS account exists; it lives on its own branch. Do not start Phase 3 before Phase 2's gate and report are accepted.
- **Never touch `../RemoteAccessApp`.** It has uncommitted work that is not yours. Stage only `Server/` and `.github/`.
- **Contract first:** edit `contracts/*.yaml`, run `npm run contracts:types`, then code.
- **Stack is ESM** (Nest 12): `"type": "module"`, NodeNext, import local files with a `.js` suffix. TypeScript is pinned to 6.0.x (typescript-eslint does not support 7). Prisma is pinned to 7.10.1 (`latest` on npm is an 8.0 release candidate).
- **No `tsx`/esbuild** for running or testing: they drop decorator metadata, which Nest DI needs. Use `nest start --watch` and Vitest.
- **New secret field in a contract?** Add its exact key to `SENSITIVE_KEYS`; `test/security/contract-redaction.spec.ts` fails the build otherwise.
- **No `console.*`** (ESLint error). Use the pino logger. Add new sensitive keys to `SENSITIVE_KEYS` in `src/common/logger.ts`.
- **Windows:** run Vitest from a shell whose cwd uses an uppercase drive letter (see README → Troubleshooting). In Git Bash use `cd "C:/Users/..."` (uppercase `C`, with quotes), not `cd /c/Users/...`.
- **Every route is protected by default** (global `AuthGuard`). Public routes carry `@Public()`; the caller is `@CurrentActor()`. Never read a user or device id from a body or query.
- **Auth invariants:** only `EdDSA` access tokens; refresh tokens are stored as SHA-256 only; a refresh runs in one transaction under the per-family advisory lock (do not remove it: `refresh.integration.spec.ts` fails without it); the reuse branch must return, not throw, inside the transaction.
- **Tests:** unit tests are `test/unit/*.spec.ts` (no Docker); anything that needs containers or a built server is `*.integration.spec.ts` (also under `test/security/`). Integration helpers: `test/integration/helpers/{stack,client}.ts`. Test keys are generated at run time; never commit a PEM.
- **Prisma:** `datasource` URL lives in `prisma.config.ts`, never in the schema. `prisma migrate diff` needs a dummy `DATABASE_URL` or it silently prints nothing.
- **Verification before saying "done":** `npm run typecheck && npm run lint && npm run format:check && npm run contracts:check && npm test && npm run test:integration` (the last needs Docker). For the live stack: `node scripts/smoke-auth.mjs http://127.0.0.1:3000`.
- Every phase ends with a report in `docs/phase-reports/` using the format in rules §4. Be explicit about what was not verified.
