# Server Phase 4 — Sessions, Consent and Abuse Protection

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** 2–3 weeks
**Unlocks:** app Milestone 5 (request → consent → accept/reject workflow)
**Goal:** the server owns the session lifecycle. Only the target phone's owner can accept, every change is audited, requests expire, and abuse is limited.

---

## 1. Data model

```prisma
model Session {
  id                  String        @id @default(uuid()) @db.Uuid
  controllerUserId    String        @db.Uuid
  controllerDeviceId  String        @db.Uuid
  targetUserId        String        @db.Uuid
  targetDeviceId      String        @db.Uuid
  status              SessionStatus
  controlGranted      Boolean       @default(false)   // always false in v1 (Phase 7 changes this)
  relayOnly           Boolean       @default(true)
  requestedAt         DateTime      @default(now()) @db.Timestamptz
  expiresAt           DateTime      @db.Timestamptz
  acceptedAt          DateTime?     @db.Timestamptz
  connectedAt         DateTime?     @db.Timestamptz
  endedAt             DateTime?     @db.Timestamptz
  endReason           String?
  idempotencyKey      String?
  version             Int           @default(0)       // optimistic locking
  @@unique([controllerDeviceId, idempotencyKey])
  @@index([targetDeviceId, status])
  @@index([controllerUserId, requestedAt])
}

enum SessionStatus {
  waiting_for_approval
  accepted
  connected
  rejected
  expired
  cancelled
  ended
  failed
}

model SessionEvent {
  id            String   @id @default(uuid()) @db.Uuid
  sessionId     String   @db.Uuid
  actorDeviceId String?  @db.Uuid              // null = system (expiry)
  type          String                          // requested, accepted, rejected, cancelled, expired, connected, ended, reported, control_granted…
  ipHash        String?                         // HMAC-SHA256(ip, IP_HASH_KEY)
  metadata      Json?                           // no secrets, no SDP
  createdAt     DateTime @default(now()) @db.Timestamptz
  @@index([sessionId])
}

model Block {
  blockerUserId String   @db.Uuid
  blockedUserId String   @db.Uuid
  createdAt     DateTime @default(now()) @db.Timestamptz
  @@id([blockerUserId, blockedUserId])
}
model Report {
  id             String   @id @default(uuid()) @db.Uuid
  reporterUserId String   @db.Uuid
  reportedUserId String   @db.Uuid
  sessionId      String?  @db.Uuid
  reason         String
  status         String   @default("open")
  createdAt      DateTime @default(now()) @db.Timestamptz
}
```

## 2. Session state machine (single source of truth)

`src/modules/sessions/session.machine.ts`:

```ts
export const transitions: Record<SessionStatus, SessionStatus[]> = {
  waiting_for_approval: ['accepted', 'rejected', 'cancelled', 'expired'],
  accepted:             ['connected', 'ended', 'failed'],
  connected:            ['ended', 'failed'],
  rejected: [], expired: [], cancelled: [], ended: [], failed: [],
};
```

`SessionService.transition(sessionId, to, actor, reason?)`:
1. In a transaction: load the session, check `to ∈ transitions[from]`, check the **actor's permission** for that transition (table below), update with `WHERE id = ? AND version = ?` (optimistic lock) and `version + 1`.
2. Insert a `SessionEvent`.
3. After commit: emit realtime events and enqueue push where listed.
4. Any failed check → `409 invalid_session_state` or `403/404` (see below). Nothing changes.

| Transition | Allowed actor |
|---|---|
| → accepted | target **device** (`actor.deviceId == targetDeviceId`), and `now < expiresAt` |
| → rejected | target device |
| → cancelled | controller device |
| → expired | system (worker) only |
| → connected | either party's device (Phase 5 calls this when signaling completes) |
| → ended | either party's device, or system (timeouts, revocation) |
| → failed | either party's device, or system |

Return `404 not_found` when the caller is not a party to the session (do not reveal its existence).

## 3. Endpoints

| Endpoint | Rules |
|---|---|
| POST `/api/sessions/request` | Body `targetPublicId, pin?, integrityToken`; header `Idempotency-Key` (required, UUID). Steps in §4. Returns `{ sessionId, status, expiresAt, targetDeviceName }`. Same key + same device → return the original result. |
| GET `/api/sessions/:id` | Parties only. Returns the target-facing details: controller display name, controller device name, `controllerAccountAgeDays`, `previouslyApproved`, `expiresAt`, status. |
| POST `/api/sessions/:id/accept` | Target device; `Idempotency-Key`. Body `{ controlGranted: false }` — any `true` is rejected with `400` in v1. |
| POST `/api/sessions/:id/reject` | Target device. |
| POST `/api/sessions/:id/cancel` | Controller device. |
| POST `/api/sessions/:id/disconnect` | Either party; `endReason` from a fixed list. |
| POST `/api/sessions/:id/report` | Either party; `reason` from a fixed list + optional 500-char note. Creates `Report` + event. |
| GET `/api/sessions/history?cursor=&limit=` | Caller's sessions as either party, newest first, cursor pagination, `limit ≤ 50`. Returns role, remote device name and public ID, times, duration, final status. |
| GET/PUT `/api/settings` | `onlyMyDevices`, `requirePin`, `relayOnlyDefault`. |
| POST `/api/blocks`, DELETE `/api/blocks/:userId`, GET `/api/blocks` | Block list management. |
| POST `/api/devices/:id/pin` | Target device generates a one-time 6-digit PIN for display (stored hashed in `pin:{deviceId}`, TTL 5 min). |

## 4. Request checks (in this order, fail closed)

1. Integrity verdict ok (Phase 2 service).
2. Controller device is the caller's own, not revoked.
3. Normalise `targetPublicId` (digits only). Look up target device; not found or revoked → `404 device_not_found`.
4. Target ≠ controller device.
5. Rate limits (Redis):
   - per controller user: 20 requests / hour total;
   - per controller user → **unfamiliar** target (no previously accepted session between these users): 5 / hour;
   - per IP: 30 / hour;
   - per target device: 10 incoming / 10 min (protects targets from spam).
6. Block check either direction → respond `404 device_not_found` (do not reveal the block).
7. Target settings: `onlyMyDevices` and different user → `404 device_not_found`. `requirePin` → PIN required and verified against `pin:{deviceId}` (constant-time compare, delete on success; 5 wrong attempts → PIN invalidated).
8. Target has a session already `waiting_for_approval` or active → `409 target_busy`.
9. Target presence: offline and no `fcmToken` → `409 device_offline` (don't create the session).
10. Create the session (`expiresAt = now + 60 s`), event `requested`, then:
    - realtime `session:incoming { sessionId }` to `device:{target}`;
    - if target offline → push job `{ type: 'session_request', sessionId }`;
    - delayed BullMQ job `expire-session` at `expiresAt`.

## 5. Worker jobs

- `expire-session`: if status is still `waiting_for_approval`, transition to `expired` (actor: system), emit `session:expired` to both devices. Idempotent.
- `stale-session-sweeper` (every minute): `accepted` for > 2 min without `connected` → `failed`; `connected` with both parties' presence missing for > 2 min → `ended` (`endReason: connection_lost`).
- `session-summary-email` after `ended` (if email provider configured): to the **target** account — who, when, how long. No content.

## 6. Realtime events emitted (update `asyncapi.yaml`)

`session:incoming`, `session:accepted`, `session:rejected`, `session:cancelled`, `session:expired`, `session:ended` — payload `{ sessionId, status, reason? }` only. Emitted only by `SessionService` after commit, to `device:{controllerDeviceId}` and `device:{targetDeviceId}`.

## 7. Required tests

**Authorization matrix (mandatory, table-driven):** for every session endpoint × actor ∈ {controller device, target device, other device of target's user, other device of controller's user, stranger, revoked device} × status ∈ every `SessionStatus` → assert expected HTTP code and that nothing changed when denied.

Plus:
- Accept after `expiresAt` → `409`, status becomes/remains `expired`.
- Replay accept with the same `Idempotency-Key` → same response, one event.
- Concurrent accept + cancel → exactly one wins (optimistic lock), the other `409`.
- Rate limits trigger at the documented numbers; unfamiliar-target limit independent of total.
- Blocked controller gets the same `404` as a non-existent ID (bodies identical).
- `onlyMyDevices` and PIN flows, including 5 wrong PINs.
- Expiry job emits `session:expired` and is safe to run twice.
- History pagination returns both roles, no other users' sessions.
- `controlGranted: true` on accept → `400` in v1.

## 8. Gate

- [ ] Two real phones complete request → accept → disconnect, and request → reject, against staging.
- [ ] Authorization matrix passes in CI.
- [ ] Replayed, expired and cancelled requests cannot be accepted.
- [ ] Every transition writes a `SessionEvent`.
- [ ] Contracts updated; app team notified.
- [ ] Phase report submitted.
