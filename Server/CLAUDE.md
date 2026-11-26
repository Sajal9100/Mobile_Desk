# MobileDesk Server - working notes for coding agents

**Before any work, read** `docs/briefs/00_SERVER_AGENT_RULES.md` and the brief of the current phase (`docs/briefs/Phase_N_*.md`). If a brief and the architecture doc disagree, stop and ask.

- **Current phase:** 0 (foundation) is accepted (PR #2 merged 2026-11-26). Next is Phase 2, once its prerequisites are settled (see the Phase 0 report). Phase 1 (throwaway TURN relay) runs alongside by decision; it lives on its own branch.
- **Never touch `../RemoteAccessApp`.** It has uncommitted work that is not yours. Stage only `Server/` and `.github/`.
- **Contract first:** edit `contracts/*.yaml`, run `npm run contracts:types`, then code.
- **Stack is ESM** (Nest 12): `"type": "module"`, NodeNext, import local files with a `.js` suffix. TypeScript is pinned to 6.0.x (typescript-eslint does not support 7). Prisma is pinned to 7.10.1 (`latest` on npm is an 8.0 release candidate).
- **No `tsx`/esbuild** for running or testing: they drop decorator metadata, which Nest DI needs. Use `nest start --watch` and Vitest.
- **New secret field in a contract?** Add its exact key to `SENSITIVE_KEYS`; `test/security/contract-redaction.spec.ts` fails the build otherwise.
- **No `console.*`** (ESLint error). Use the pino logger. Add new sensitive keys to `SENSITIVE_KEYS` in `src/common/logger.ts`.
- **Windows:** run Vitest from a shell whose cwd uses an uppercase drive letter (see README → Troubleshooting).
- **Prisma:** `datasource` URL lives in `prisma.config.ts`, never in the schema. `prisma migrate diff` needs a dummy `DATABASE_URL` or it silently prints nothing.
- **Verification before saying "done":** `npm run typecheck && npm run lint && npm test && npm run test:integration` (the last needs Docker).
- Every phase ends with a report in `docs/phase-reports/` using the format in rules §4. Be explicit about what was not verified.
