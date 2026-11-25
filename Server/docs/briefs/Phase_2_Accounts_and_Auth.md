# Server Phase 2 — Accounts and Authentication

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** about 2 weeks
**Unlocks:** app Milestone 3 (real login)
**Goal:** secure registration, login, token refresh with rotation and reuse detection, logout, account deletion, and Play Integrity verification.

---

## 1. Data model (Prisma)

```prisma
model User {
  id           String    @id @default(uuid()) @db.Uuid
  email        String    @unique            // stored lower-cased and trimmed
  passwordHash String
  displayName  String
  status       UserStatus @default(active)
  createdAt    DateTime  @default(now()) @db.Timestamptz
  deletedAt    DateTime? @db.Timestamptz
  settings     UserSettings?
  refreshTokens RefreshToken[]
}

enum UserStatus {
  active
  suspended
}

model RefreshToken {
  id         String    @id @default(uuid()) @db.Uuid
  userId     String    @db.Uuid
  deviceId   String?   @db.Uuid              // set once the device is registered (Phase 3)
  familyId   String    @db.Uuid
  tokenHash  String    @unique               // SHA-256 hex of the raw token
  expiresAt  DateTime  @db.Timestamptz       // absolute expiry: family start + 30 days
  usedAt     DateTime? @db.Timestamptz
  revokedAt  DateTime? @db.Timestamptz
  createdAt  DateTime  @default(now()) @db.Timestamptz
  user       User      @relation(fields: [userId], references: [id])
  @@index([familyId])
  @@index([userId])
}

model UserSettings {
  userId            String  @id @db.Uuid
  onlyMyDevices     Boolean @default(false)
  requirePin        Boolean @default(false)
  relayOnlyDefault  Boolean @default(true)
  user              User    @relation(fields: [userId], references: [id])
}
```

## 2. Endpoints (update `openapi.yaml` first)

| Endpoint | Body | Response | Notes |
|---|---|---|---|
| GET `/api/integrity/nonce` | — | `{ nonce }` | 32 random bytes base64url; stored in Redis `integrity-nonce:{nonce}` TTL 5 min; rate limit 30/min/IP |
| POST `/api/auth/register` | `displayName, email, password, integrityToken` | `{ user, accessToken, refreshToken }` | Email taken → `409 email_taken` |
| POST `/api/auth/login` | `email, password, integrityToken` | `{ user, accessToken, refreshToken }` | Wrong email **or** password → `401 invalid_credentials` (same message, similar timing) |
| POST `/api/auth/refresh` | `refreshToken` | `{ accessToken, refreshToken }` | Rotation + reuse detection (§4) |
| POST `/api/auth/logout` | `refreshToken` | `204` | Revokes the family |
| DELETE `/api/account` | `password` | `204` | Soft delete now, hard-delete job in Phase 6; revoke all families |
| GET `/api/me` | — | `{ user }` | Protected |

Validation: email RFC-valid, ≤ 254 chars, lower-cased; displayName 2–50 chars, trimmed; password 10–128 chars with at least one letter and one digit.

## 3. Passwords

- `argon2.hash(password, { type: argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })` (OWASP baseline; raise memory if the server can afford it, measure ≤ 250 ms).
- On login for a non-existent email, still run `argon2.verify` against a fixed dummy hash so timing does not reveal whether the account exists.
- Re-hash on login if parameters have changed (`argon2.needsRehash`).

## 4. Tokens

### 4.1 Access token
- `jose` `SignJWT`, alg `EdDSA`, 15 min expiry, claims: `sub` (userId), `did` (deviceId or null), `iss` = `https://api.mobiledesk.app`, `aud` = `mobiledesk-app`, `iat`, `exp`, `jti`. Header `kid`.
- Keys: Ed25519 private key(s) from the secrets manager via config (`JWT_PRIVATE_KEYS` as a JSON map of `kid → PEM`, `JWT_ACTIVE_KID`). Public keys derived at startup.
- Verification: `jwtVerify(token, keyByKid, { algorithms: ['EdDSA'], issuer, audience, clockTolerance: 30 })`. Reject any other `alg`.
- `AuthGuard` attaches `actor = { userId, deviceId }`; rejects users with `status != active` or `deletedAt` set (cache user status in Redis for 60 s to avoid a DB hit per request).

### 4.2 Refresh token — rotation with reuse detection
- Raw token: 32 random bytes, base64url. Store only `sha256(raw)`.
- On login/register: new `familyId`, `expiresAt = now + 30 days`.
- On refresh, inside **one DB transaction** with row lock:

```ts
const hash = sha256(raw);
const row = await tx.refreshToken.findUnique({ where: { tokenHash: hash } }); // SELECT … FOR UPDATE via $queryRaw if needed
if (!row) throw unauthorized('invalid_refresh_token');
if (row.revokedAt || row.expiresAt < now) throw unauthorized('invalid_refresh_token');
if (row.usedAt) {
  // REUSE: token already rotated → assume theft
  await tx.refreshToken.updateMany({ where: { familyId: row.familyId, revokedAt: null }, data: { revokedAt: now } });
  await audit('refresh_reuse_detected', { userId: row.userId, familyId: row.familyId });
  await realtime.disconnectUser(row.userId, row.deviceId);       // Phase 3 hook; no-op until then
  throw unauthorized('refresh_reuse_detected');
}
await tx.refreshToken.update({ where: { id: row.id }, data: { usedAt: now } });
const next = newRawToken();
await tx.refreshToken.create({ data: { userId: row.userId, deviceId: row.deviceId, familyId: row.familyId,
  tokenHash: sha256(next), expiresAt: row.expiresAt } });          // keep the family's absolute expiry
return { accessToken: signAccess(row.userId, row.deviceId), refreshToken: next };
```

- **Grace for concurrent refreshes:** the app uses single-flight refresh, so no grace window is needed. Do not add one without a human decision.
- Logout: revoke all tokens in the presented token's family.
- Cleanup job (worker): delete rows expired > 7 days ago.

## 5. Play Integrity verification

- Module `integrity` with `IntegrityService.verify(token, expectedNonce)`.
- Call Google's `decodeIntegrityToken` API for the package name using a service account (credentials JSON from the secrets manager).
- Agree with the app team whether they use **classic** requests (verify `requestDetails.nonce`) or **standard** requests (verify `requestDetails.requestHash`). Implement the agreed one only.
- Checks:
  - `requestDetails.requestPackageName` equals the app package.
  - Nonce/hash matches, and the Redis nonce exists → delete it (single use).
  - `requestDetails.timestampMillis` within 2 minutes.
  - `appIntegrity.appRecognitionVerdict == PLAY_RECOGNIZED` and `certificateSha256Digest` contains the release signing cert digest (config).
  - `deviceIntegrity.deviceRecognitionVerdict` contains `MEETS_DEVICE_INTEGRITY`.
- Result is a verdict object `{ ok, reasons[] }`. **Policy:** register and login require `ok`. If Google is unreachable, fail closed with `503 integrity_unavailable` (retryable).
- `INTEGRITY_MODE` config: `enforce` (staging/prod) or `bypass` (local only). The server **refuses to start** with `bypass` when `NODE_ENV=production`.

## 6. Rate limits (Redis, sliding or fixed window)

| Scope | Limit |
|---|---|
| Login per email | 10 per 15 min, then `429 rate_limited` with `Retry-After` |
| Login per IP | 30 per 15 min |
| Register per IP | 5 per hour |
| Refresh per family | 30 per 15 min |
| Nonce per IP | 30 per min |

Behind a load balancer, read the client IP only from the trusted proxy header configured in Fastify `trustProxy`.

## 7. Required tests

Unit:
- Password policy; email normalisation.
- JWT: valid token passes; `alg: none`, HS256-signed, wrong `aud`, wrong `iss`, expired, unknown `kid` all fail.

Integration (Testcontainers):
- Register → login → `/api/me` works.
- Wrong password and unknown email return the identical body.
- Refresh rotates: old token reused → `401 refresh_reuse_detected` **and** the new token from the same family is also revoked.
- Logout revokes the family; refresh after logout fails.
- Suspended user's valid access token is rejected within 60 s.
- Rate limit returns `429` with `Retry-After`.
- Integrity: missing / wrong-package / replayed nonce / old timestamp → rejected (mock Google client).
- Account deletion revokes all families and blocks login.

Security:
- No response or log line contains the raw refresh token after issuance (log capture test).

## 8. Gate

- [ ] App login, refresh and logout work against staging (or local with `INTEGRITY_MODE=bypass` while Play setup is pending; record which).
- [ ] All tests in §7 pass in CI.
- [ ] JWT signing keys and Google credentials come from config/secrets only.
- [ ] OpenAPI updated; app team notified.
- [ ] Phase report with SECURITY IMPACT submitted.
