# Server Phase 7 — Remote Control Support (v2)

**Read first:** `00_SERVER_AGENT_RULES.md`
**Effort:** about 1 week (server side; most v2 work is native app code)
**Unlocks:** app Milestone 7 (remote control)
**Prerequisite:** v1 launched; the native AccessibilityService track is ready; Google Play accessibility declaration in progress.
**Goal:** record and enforce the target owner's explicit, revocable permission for remote control. The server never sends input itself; input travels over the WebRTC data channel and is enforced on the target phone.

---

## 1. Principles

- Control is **off by default** and granted **per session** by the **target device only**.
- The controller can never grant, request-and-assume, or extend control.
- The target can revoke at any time; revocation is immediate and audited.
- The server's flag is a record and a signal. The target phone's native layer remains the final enforcement point (app plan §17.6).

## 2. Changes

### 2.1 Feature flag
- `FEATURE_REMOTE_CONTROL` config (default `false`). With it off, all endpoints below return `404` and `controlGranted: true` on accept stays rejected.

### 2.2 Endpoints (update `openapi.yaml`)

| Endpoint | Rules |
|---|---|
| POST `/api/sessions/:id/control/request` | Controller device only; session `connected`; rate limit 3 per session. Emits `session:control-requested` to the target. Does **not** change `controlGranted`. |
| POST `/api/sessions/:id/control/grant` | Target device only; session `connected`; `Idempotency-Key`. Sets `controlGranted = true`, event `control_granted`, emits `session:control-changed { granted: true }` to both. |
| POST `/api/sessions/:id/control/revoke` | Target device (or system on session end). Sets `false`, event `control_revoked`, emits `session:control-changed { granted: false }`. |

- Accept body `controlGranted: true` remains rejected — control is granted only after the session is connected and the target has seen the screen being shared.
- On any transition out of `connected`, set `controlGranted = false` in the same transaction.

### 2.3 Realtime
- New server→client events `session:control-requested`, `session:control-changed` (AsyncAPI).
- No input events go through the signaling server. If any `input:*` event arrives on the socket, drop it and count a violation.

### 2.4 Abuse signals
- Track in metrics: control grants per session, grants for accounts younger than 30 days, reports filed after controlled sessions.
- Policy option (human decision): block control for controller accounts younger than N days, or require that the two accounts have a previous completed view-only session.

## 3. Required tests

- Controller calling `grant` → `404`/`403`, no change.
- Target granting when status is not `connected` → `409`.
- Revoke works at any time while connected; session end forces `controlGranted = false`.
- Flag off → all control endpoints `404`.
- Every grant/revoke writes a `SessionEvent` and emits `session:control-changed` to both parties.
- `input:*` socket events are dropped.

## 4. Gate

- [ ] Control can only be granted by the target device, only during a connected session.
- [ ] Revocation and session end clear the grant immediately (tested).
- [ ] App team confirms the target's native layer ignores input unless its own state says control is granted.
- [ ] Google Play accessibility declaration approved (or recorded as pending with the flag kept off in production).
- [ ] Phase report submitted.
