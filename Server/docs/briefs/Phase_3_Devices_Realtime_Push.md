# Server Phase 3 — Devices, Realtime and Push

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** about 2 weeks
**Unlocks:** app Milestone 4 (device registration, presence, push)
**Goal:** every phone gets a server-assigned public ID; phones hold an authenticated realtime connection with presence; the server can wake a sleeping phone with push.

---

## 1. Data model

```prisma
model Device {
  id          String    @id @default(uuid()) @db.Uuid
  publicId    String    @unique              // 9–10 random digits (length decided in open decisions)
  userId      String    @db.Uuid
  name        String
  model       String?
  platform    String    @default("android")
  fcmToken    String?                          // never logged
  lastSeenAt  DateTime? @db.Timestamptz
  revokedAt   DateTime? @db.Timestamptz
  createdAt   DateTime  @default(now()) @db.Timestamptz
  @@index([userId])
}
```

Add `deviceId` linkage to `RefreshToken` (already nullable from Phase 2): after device registration, the server issues a new token pair bound to the device.

## 2. Device registry

| Endpoint | Behaviour |
|---|---|
| POST `/api/devices/register` | Body: `name, model, integrityToken, fcmToken?`. Verifies integrity. Creates the device with a new `publicId`, then **rotates** the caller's refresh family into a new family bound to this device. Returns `{ device, accessToken, refreshToken }`. Limit: 10 active devices per user. |
| GET `/api/devices` | The caller's non-revoked devices with `status` (from presence) and `isCurrentDevice`. |
| PATCH `/api/devices/:id` | Rename (2–40 chars). Owner only. |
| DELETE `/api/devices/:id` | Owner only. Sets `revokedAt`, revokes all refresh families bound to it, disconnects its sockets, clears `fcmToken`. Removing the current device = logout. |
| PUT `/api/devices/:id/push-token` | Owner and **same device** only (`actor.deviceId == id`). |

**Public ID generation:**
```ts
function newPublicId(len: 9 | 10): string {
  // first digit 1–9, rest 0–9, from crypto.randomInt (CSPRNG)
  let s = String(crypto.randomInt(1, 10));
  for (let i = 1; i < len; i++) s += String(crypto.randomInt(0, 10));
  return s;
}
// insert with retry on unique-constraint violation (max 5 attempts)
```
Never derive IDs from counters, timestamps, phone numbers or hardware IDs.

`404 not_found` (not `403`) for another user's device, so device existence is not revealed.

## 3. Realtime gateway (`main-realtime.ts`)

### 3.1 Tickets
- `POST /api/realtime/ticket` (API process, authenticated, **device-bound token required**): returns `{ ticket }` — 32 random bytes base64url — stored as `ws-ticket:{ticket}` → `{ userId, deviceId }` with TTL 30 s. Rate limit 20/min per device.

### 3.2 Handshake
- Socket.IO server with `transports: ['websocket']`, `maxHttpBufferSize: 16384`, `pingInterval: 20000`, `pingTimeout: 20000`, Redis adapter.
- Middleware:
  ```ts
  io.use(async (socket, next) => {
    const ticket = socket.handshake.auth?.ticket;
    if (typeof ticket !== 'string' || ticket.length > 64) return next(new Error('unauthorized'));
    const raw = await redis.getdel(`ws-ticket:${ticket}`);        // single use
    if (!raw) return next(new Error('unauthorized'));
    const { userId, deviceId } = TicketSchema.parse(JSON.parse(raw));
    if (await devices.isRevoked(deviceId) || !(await users.isActive(userId))) return next(new Error('unauthorized'));
    socket.data.actor = { userId, deviceId };
    next();
  });
  ```
- On connect: join rooms `user:{userId}` and `device:{deviceId}`; set `presence:{deviceId}` (TTL 60 s) and `socket:{socketId}`; emit `device:presence { deviceId, online: true }` to `user:{userId}`.
- Heartbeat: client `ping` every 20 s refreshes presence TTL. On disconnect: if no other socket for the device, delete presence, update `lastSeenAt`, emit offline.
- **Never** put tokens in the URL; reject handshakes that include `token` or `access_token` query parameters.

### 3.3 Forced disconnects
- `RealtimeService.disconnectDevice(deviceId)` and `disconnectUser(userId)`: publish via Redis adapter `io.in('device:…').disconnectSockets(true)`. Called by device removal, logout, refresh reuse detection and account suspension/deletion.

### 3.4 Inbound events in this phase
- Only `ping`. Any other inbound event → ignored and counted; more than 20 unknown events/min → disconnect.
- Per-socket rate limit: 50 events / 10 s.

## 4. Push (FCM)

- `PushService.sendDataMessage(deviceId, data: Record<string,string>)` using `firebase-admin` `messaging().send({ token, data, android: { priority: 'high', ttl: 60_000 } })`.
- **Data only** — no `notification` block; payload contains only IDs and a type (e.g. `{ type: 'session_request', sessionId }`). Never names, emails or messages.
- Sending runs in the worker (BullMQ queue `push`) with 3 retries and exponential backoff.
- If FCM returns `registration-token-not-registered` / `invalid-registration-token`, clear `fcmToken` on that device.
- Credentials: service-account JSON from secrets (`FCM_SERVICE_ACCOUNT_JSON`), never committed.
- Add a development-only endpoint `POST /api/dev/push-test` (enabled only when `NODE_ENV != production`) that sends `{ type: 'test' }` to the caller's own device, for the app team's M4 gate.

## 5. Required tests

Integration:
- Register device → `publicId` is 9–10 digits, unique; device-bound token pair returned; old family revoked.
- Other user's device → `404` for GET/PATCH/DELETE/push-token.
- Ticket: works once; second use rejected; expired (31 s) rejected; ticket of a revoked device rejected.
- Handshake with `?token=` in URL rejected.
- Presence: online after connect, offline after disconnect, correct across **two realtime instances** (Testcontainers Redis + two servers).
- Device removal disconnects its socket within 2 s and blocks refresh.
- Push: invalid FCM token clears `fcmToken` (mock firebase-admin); payload contains no PII (assert keys).
- Socket flood (> limit) disconnects the client.

## 6. Gate

- [ ] A real phone registers, shows its server-assigned ID and online status in the app.
- [ ] A backgrounded phone receives the dev test push.
- [ ] Removing a device from another phone disconnects it within seconds.
- [ ] All §5 tests pass in CI.
- [ ] OpenAPI + AsyncAPI updated; app team notified.
- [ ] Phase report submitted.
