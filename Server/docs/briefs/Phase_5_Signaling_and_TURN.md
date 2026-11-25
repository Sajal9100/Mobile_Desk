# Server Phase 5 — Signaling and Production TURN

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** 1–2 weeks
**Unlocks:** app Milestone 6 (view-only screen sharing end to end)
**Goal:** the two phones of an accepted session can exchange WebRTC setup messages through the server, and get short-lived credentials for a hardened TURN relay.

---

## 1. Signaling relay (realtime process)

Inbound events (update `asyncapi.yaml`):

| Event | Payload (zod) | Limits |
|---|---|---|
| `webrtc:offer` | `{ sessionId: uuid, sdp: string ≤ 16 KB, type: 'offer' }` | 5 per session per minute |
| `webrtc:answer` | `{ sessionId, sdp ≤ 16 KB, type: 'answer' }` | 5 per session per minute |
| `webrtc:ice-candidate` | `{ sessionId, candidate: string ≤ 1 KB, sdpMid?: string ≤ 64, sdpMLineIndex?: int 0–16 }` | 100 per session per minute |
| `webrtc:connected` | `{ sessionId }` | 2 per session |

Handler for every event:

```ts
async function relay(socket, event, payload) {
  const msg = schemaFor(event).safeParse(payload);
  if (!msg.success) return countViolation(socket);                 // drop silently
  const { userId, deviceId } = socket.data.actor;
  const s = await sessionsCache.get(msg.data.sessionId);           // Redis cache, 10 s TTL, falls back to DB
  if (!s) return countViolation(socket);
  const isController = s.controllerDeviceId === deviceId;
  const isTarget = s.targetDeviceId === deviceId;
  if (!isController && !isTarget) return countViolation(socket);   // not a party
  if (!['accepted', 'connected'].includes(s.status)) return;       // wrong state
  if (!(await rateLimit(event, s.id, deviceId))) return countViolation(socket);
  // v1 direction rule: the TARGET (screen sender) creates the offer
  if (event === 'webrtc:offer' && !isTarget) return countViolation(socket);
  if (event === 'webrtc:answer' && !isController) return countViolation(socket);
  const otherDevice = isController ? s.targetDeviceId : s.controllerDeviceId;
  io.to(`device:${otherDevice}`).emit(event, msg.data);
}
```

- `webrtc:connected` from either party → `SessionService.transition(→ connected)` (idempotent).
- Never log `sdp` or `candidate` (already in the redact list — verify with a test).
- Invalidate the session cache on every status change (SessionService publishes `session-changed:{id}` on Redis).
- When a session leaves `accepted`/`connected`, emit `session:ended` and stop relaying immediately.
- 10 violations in 1 minute → disconnect the socket and write an audit event.

## 2. ICE configuration endpoint

`GET /api/webrtc/ice-config?sessionId=` (API process):

1. Caller must be a party, session status `accepted` or `connected`. Otherwise `404`.
2. Issue TURN REST credentials (coturn `use-auth-secret`):
   ```ts
   const ttl = 600;                                                   // 10 minutes
   const username = `${Math.floor(Date.now() / 1000) + ttl}:${sessionId}:${deviceId}`;
   const credential = crypto.createHmac('sha1', TURN_SHARED_SECRET).update(username).digest('base64');
   return {
     iceServers: [
       { urls: ['stun:turn.mobiledesk.app:3478'] },
       { urls: ['turn:turn.mobiledesk.app:3478?transport=udp',
                'turn:turn.mobiledesk.app:3478?transport=tcp',
                'turns:turn.mobiledesk.app:5349?transport=tcp'], username, credential },
     ],
     iceTransportPolicy: session.relayOnly ? 'relay' : 'all',
     ttlSeconds: ttl,
   };
   ```
   (HMAC-SHA1 is what coturn's TURN REST scheme expects; the secret itself is long and random.)
3. Rate limit 10 per session per device. Never log the response.
4. `TURN_SHARED_SECRET` from the secrets manager; support two secrets during rotation (coturn accepts multiple `static-auth-secret` lines).

## 3. Production coturn

Infrastructure as code (Terraform/CDK), not hand-built:
- Dedicated VM(s) in `ap-south-1`, static IP, DNS `turn.mobiledesk.app`, TLS certificate (Let's Encrypt or ACM-exported) for 5349.
- Firewall: UDP/TCP 3478, TCP 5349, UDP relay range (e.g. 49152–50151); SSH via bastion or SSM only.
- `turnserver.conf` (template in `infra/coturn/turnserver.conf.tmpl`, secrets injected at boot):
  ```text
  listening-port=3478
  tls-listening-port=5349
  external-ip=<PUBLIC_IP>
  realm=mobiledesk.app
  use-auth-secret
  static-auth-secret=<FROM_SECRETS_MANAGER>
  cert=/etc/coturn/fullchain.pem
  pkey=/etc/coturn/privkey.pem
  min-port=49152
  max-port=50151
  fingerprint
  no-cli
  no-multicast-peers
  no-tlsv1
  no-tlsv1_1
  denied-peer-ip=0.0.0.0-0.255.255.255
  denied-peer-ip=10.0.0.0-10.255.255.255
  denied-peer-ip=100.64.0.0-100.127.255.255
  denied-peer-ip=127.0.0.0-127.255.255.255
  denied-peer-ip=169.254.0.0-169.254.255.255
  denied-peer-ip=172.16.0.0-172.31.255.255
  denied-peer-ip=192.168.0.0-192.168.255.255
  denied-peer-ip=<VPC_CIDR_RANGE>
  user-quota=4
  total-quota=400
  max-bps=3000000
  prometheus
  log-file=stdout
  simple-log
  ```
- Expose coturn's Prometheus metrics only on the private network.
- Alerts: bandwidth > 70% of instance capacity, allocation failures, certificate expiry < 14 days.

## 4. Required tests

Integration:
- Stranger's `webrtc:offer` for a real session is dropped (other party receives nothing).
- Controller sending an offer (wrong direction) is dropped.
- Messages for a `waiting_for_approval`, `ended` or `rejected` session are dropped.
- Oversized SDP / candidate dropped; 10 violations disconnect the socket.
- `webrtc:connected` moves the session to `connected` once.
- Ending a session stops relay immediately (message after end not delivered).
- `ice-config`: non-party `404`; ended session `404`; username expiry ≈ now + 600; credential verifies with the HMAC formula; `relayOnly` sets `iceTransportPolicy: 'relay'`.
- Log capture: no SDP, candidate or credential appears.

Manual (with the app team):
- Two phones on different networks (Wi-Fi + mobile data) connect via TURN with relay-only on.
- A TURN client test attempting to relay to `10.0.0.1` and to the VPC range is refused.
- An expired credential (> 10 min) is refused by coturn.

## 5. Gate

- [ ] View-only screen sharing works between two physical phones on different networks through production-config TURN (staging).
- [ ] All §4 tests pass; manual checks recorded with evidence.
- [ ] TURN secret only in the secrets manager; rotation procedure documented in `docs/RUNBOOKS.md`.
- [ ] Contracts updated; app team notified.
- [ ] Phase report submitted.
