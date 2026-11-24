# MobileDesk — React Native Client Execution Plan (v2)

**Document type:** Agentic AI implementation specification
**Project:** MobileDesk
**Scope:** React Native mobile application (Android-first), plus the native and backend *contracts* it depends on
**Language:** TypeScript (strict)
**Architecture:** React Native Community CLI (bare React Native)
**Version:** v2 — supersedes v1. Changes from the senior engineering and security review are marked **[v2]**.
**Status:** Implementation plan

---

## 0. What changed from v1 (read first)

| # | Change | Why | Where |
|---|---|---|---|
| 1 | **New Milestone 1: risk spike.** Prove screen capture → WebRTC → second phone on real devices before building UI. | The two assumptions that can sink the product (capture/streaming, remote input) were tested last in v1. | §20 |
| 2 | **Security moved into the foundation** (Milestone 2), not left to the final milestone. | Token storage, network config, log redaction and release hardening are cheap early, expensive to retrofit. | §17, §20 |
| 3 | **Product split: v1 = view-only, v2 = remote control.** | Remote input requires AccessibilityService, which Google Play reviews strictly. View-only can ship independently. | §2, §20 |
| 4 | **The target device and the server are the security boundary**, not the controller. | A modified controller APK bypasses any controller-side check. | §17.6 |
| 5 | **No API keys or secrets in the app.** Replaced by user JWTs + Play Integrity app attestation. | Everything in an APK (including `.env` values) is extractable. | §17.1, §17.2 |
| 6 | **Concrete JWT / refresh-token design** (short-lived access token in memory, rotating refresh token in Keystore, reuse detection, device binding). | v1 said "secure storage" without a design. | §17.3 |
| 7 | **WebSocket auth via single-use ticket**, never JWT in the URL; per-message server authorization. | Query-string tokens leak into logs; connection-level auth alone lets a client signal into other sessions. | §12, §17.4 |
| 8 | **FCM push added** for incoming requests. | Android freezes background sockets; requests would be missed. | §12.1 |
| 9 | **Anti-fraud / anti-scam design** on the Accept flow. | Screen-sharing apps are widely abused in bank/UPI scams in India. | §6.4 |
| 10 | **TanStack Query for server state**, Zustand only for client state. | Avoid hand-building caching, staleness, pagination and loading/error states. | §4, §10 |
| 11 | **Session lifecycle as an explicit state machine** (XState or typed transition table); `cancelled` state added. | 11+ states fed by REST, socket, WebRTC and native events. | §10 |
| 12 | **Contract-first:** OpenAPI (REST) + AsyncAPI (socket) specs and generated types before auth work. | Prevents client/server drift. | §11, §20 |
| 13 | Evaluate **`react-native-webrtc` `getDisplayMedia()`** for capture before writing a custom capture module. | May remove most native capture work. | §13, §14 |
| 14 | **Normalized (0–1) coordinates + WebRTC data channel** for input. | Removes most aspect-ratio/rotation bugs; lower latency; encrypted P2P. | §7.11, §13 |
| 15 | **TURN credentials via TURN REST pattern**, relay-only privacy option. | No long-lived TURN secrets; hides IPs between strangers. | §13, §17.5 |
| 16 | **Android 13/14/15 and Play policy constraints** documented. | Foreground service types, MediaProjection per-session consent, restricted settings, accessibility declaration. | §2.1 |
| 17 | **Backend security requirements** listed for the backend owner. | The client is only as secure as the server. | §24 |
| 18 | **Release security checklist** and a **SECURITY IMPACT** line in every milestone report. | Makes security verifiable per milestone. | §18.5, §23 |

---

## 1. Mission

Build the React Native client for **MobileDesk**, an Android-first remote-device **assistance** application inspired by AnyDesk.

The application must allow a signed-in user to:

1. Register and sign in.
2. Register the current phone as a device.
3. View its server-assigned device ID and connection status.
4. Discover and manage devices associated with the account.
5. Enter another device's ID and request a remote session.
6. Receive and respond to incoming session requests (including when the app is in the background, via push).
7. View a remote screen after a session has been authorized by the device owner and established.
8. **[v2] (v2 release only)** Use supported remote interaction controls during an active session, after a separate explicit control grant.
9. End a session and review session history.
10. Manage application settings, permissions, and security preferences.

The client must be designed around explicit device-owner consent, resistance to social-engineering scams, visible active-session status, and an immediate stop/disconnect action.

## 2. Scope boundaries

### In scope

- React Native project setup and configuration.
- TypeScript application architecture.
- Navigation and screen UI.
- Client-side state management (Zustand) and server-state caching (TanStack Query). **[v2]**
- API client and typed API contracts generated from OpenAPI. **[v2]**
- WebSocket/realtime client integration with ticket-based auth. **[v2]**
- FCM push handling on the client. **[v2]**
- WebRTC client integration (viewer, and screen publishing via `getDisplayMedia()` if validated). **[v2]**
- Device registration UI and state.
- Session request and approval workflows, including anti-scam UX. **[v2]**
- Remote screen viewer UI.
- Remote interaction toolbar and gesture mapping (v2 release).
- Permission education and permission-state UI.
- Secure local storage of client credentials (Keychain/Keystore).
- Play Integrity client integration. **[v2]**
- Error handling, redacting logger, testing, accessibility, release hardening and release build configuration. **[v2]**
- A typed bridge/interface for Android-native capabilities.
- The **throwaway** risk-spike signaling server used only in Milestone 1 (local, unauthenticated, deleted afterwards). **[v2]**
- Contract documents (OpenAPI, AsyncAPI, native interface, backend security requirements) for coordination. **[v2]**

### Out of scope

The agent must **not implement or deploy** any of the following:

- Production backend APIs or backend business logic.
- Authentication server, database, device registry, or server-side device-ID generation.
- Production WebSocket signaling server.
- Production STUN/TURN server or Coturn deployment (a local/test TURN may be used in the risk spike only, with documented throwaway credentials that are never committed).
- Cloud infrastructure, DNS, TLS termination, load balancers, or hosting.
- Kotlin implementation of AccessibilityService or input injection (owned by the native track; see §14). **[v2]** Note: a foreground service declaration required by `react-native-webrtc` screen capture *is* in scope if the risk spike validates that path.
- iOS implementation or iOS remote-control support.
- Silent, hidden, persistent, or non-consensual access to any device.

The client may define interfaces, types, configuration keys, and integration adapters for these systems. It must not pretend that a feature works when its required server or native implementation is absent.

### 2.1 Platform and policy reality [v2]

| Area | Constraint | Consequence |
|---|---|---|
| Screen capture | MediaProjection needs user consent via a system dialog. On Android 14+ consent is valid for **one capture session only** and cannot be reused. | Request it every session, after Accept. |
| Foreground service | Android 14+ requires `foregroundServiceType="mediaProjection"`, the `FOREGROUND_SERVICE_MEDIA_PROJECTION` permission, and a running FGS before capture. Play Console requires an FGS declaration. | Document in `NATIVE_INTEGRATION_INTERFACE.md`; prepare a demo video for Play. |
| Partial sharing | Android 14 QPR2+ lets the user share a single app. | Viewer must handle app-only and black frames. |
| Sensitive content | Android 15 hides sensitive notifications (e.g. OTPs) during sharing; `FLAG_SECURE` apps show black. | Expected behaviour. **Never attempt to bypass.** |
| Remote input | No public API injects input into other apps. Only legitimate route: `AccessibilityService` (`dispatchGesture()`, `performGlobalAction()`). | v2 release only, native track. |
| Accessibility on Play | Non-accessibility-tool apps need prominent disclosure, consent, and a Play Console declaration; review is strict. | v1 ships without it. |
| Restricted settings | Android 13+ blocks enabling accessibility for sideloaded apps until the user allows it in App info. | Document for test-APK users. |
| Notifications | Android 13+ requires `POST_NOTIFICATIONS` runtime permission. Android 14 restricts `USE_FULL_SCREEN_INTENT` to calling/alarm apps. | Ask with explanation on the dashboard; use heads-up notifications, not full-screen intents. |
| iOS | No third-party remote control. | Out of scope. |
| India (DPDP Act 2023) | Personal data minimisation, privacy notice, deletion. | Account deletion flow (also a Play requirement); never store screen content. |

Do not promise iPhone control, guaranteed background availability, or control of `FLAG_SECURE` apps.

## 3. Agent operating rules

1. **Inspect before changing.** Check the repository, package versions, existing code, scripts, and Android configuration before making changes.
2. **Do not overwrite user work.** Preserve existing files and conventions unless a change is necessary and explained.
3. **Work in small milestones.** Implement one milestone, run its checks, report, then continue. **Do not start a milestone until the previous milestone's gate passes.** **[v2]**
4. **Use TypeScript strictly.** `strict: true`, no `any`, no `@ts-ignore` without a written reason. Typed API responses, events, navigation params and state.
5. **Keep UI separate from infrastructure.** Screens must not contain raw networking, WebRTC negotiation, token handling, or native bridge details.
6. **No fake success.** Mock data must be visibly labelled. Never display "Connected" unless a real connection state confirms it.
7. **No secrets in the app or in source control.** **[v2]** The app bundle contains only public values. If leaking a value would be a security incident, it must not be in the app. See §17.1.
8. **Consent first.** Incoming requests must be visible and require the target owner's deliberate approval through the anti-scam Accept flow (§6.4).
9. **Visible access.** An active session shows a persistent in-app banner, a foreground notification, and a one-tap Stop.
10. **Fail closed.** If authentication, authorization, permission, integrity or session state is uncertain, do not stream and do not enable interaction.
11. **Contract-first.** **[v2]** Do not invent backend contracts. Write/maintain OpenAPI and AsyncAPI specs, generate types from them, and mark unresolved details as `TODO(backend):`.
12. **Do not install packages blindly.** Verify compatibility with the project's React Native version, New Architecture status, and Android toolchain before adding dependencies. Review any package that ships native code.
13. **No platform workarounds.** Never bypass Android security, permission dialogs, `FLAG_SECURE`, accessibility restrictions, restricted settings, or store policy.
14. **Document every native dependency:** capability, permissions, Android versions, build implications, Play declarations required.
15. **Keep the app runnable.** Every milestone leaves the project building and its tests passing.
16. **Never log secrets.** **[v2]** Use the redacting logger only (§17.7). No `console.*` in feature code.
17. **Security impact in every report.** **[v2]** Each milestone report lists new secrets, permissions, endpoints, stored data and exported components introduced (§23).
18. **The controller is untrusted.** **[v2]** Controller-side gating is UX only. Every security decision is enforced by the server and/or the target device.

## 4. Technology choices

Use versions compatible with the React Native release selected in Milestone 0. Do not force versions without verification.

| Area | Choice | Responsibility |
|---|---|---|
| Framework | React Native Community CLI | Bare React Native app |
| Language | TypeScript (strict) | Application code and contracts |
| Navigation | React Navigation (typed) | Stack and tab navigation |
| HTTP | Axios | REST requests, single configured instance |
| Server state | **TanStack Query [v2]** | Devices, history, profile: caching, staleness, pagination, retries |
| Client state | Zustand | Auth status, live session, UI flags only |
| Session lifecycle | **XState or typed transition-table reducer [v2]** | Session state machine |
| Forms | React Hook Form + Zod | Form state and validation |
| Runtime validation | **Zod [v2]** | API responses and realtime event payloads |
| Contract types | **openapi-typescript (+ AsyncAPI-derived types) [v2]** | Generated from specs |
| Secure storage | react-native-keychain | Refresh token only |
| App attestation | **Play Integrity API (vetted module or small native module) [v2]** | Prove genuine app on genuine device |
| Push | **@react-native-firebase/messaging (FCM) [v2]** | Background incoming-request delivery |
| Realtime | socket.io-client **if** backend uses Socket.IO, otherwise native WebSocket | Realtime events |
| Streaming | react-native-webrtc (verify New Architecture compatibility) | Peer connection, rendering, `getDisplayMedia()` |
| Unit tests | Jest | Utilities, stores, services, state machine |
| UI tests | React Native Testing Library | Component behaviour |
| E2E | Detox or compatible | Critical journeys |
| Lint/format | ESLint + Prettier | Code quality |
| Secret scanning | **gitleaks [v2]** | CI + pre-commit |
| Release log stripping | **babel-plugin-transform-remove-console [v2]** | Remove `console.*` in release |

Do not add a UI component library by default. Build a small design system first.

## 5. Initial environment and repository inspection

Before implementation:

1. Confirm Node.js and npm versions.
2. Confirm Android Studio and Android SDK installation.
3. Confirm the JDK version required by the selected React Native release.
4. Confirm `ANDROID_HOME` / `ANDROID_SDK_ROOT`.
5. Confirm `adb devices` detects an emulator or physical test device.
6. Inspect the repository and determine whether a React Native project already exists.
7. If not, create a bare React Native TypeScript project using the current official Community CLI instructions.
8. Record React Native, React, Gradle, AGP, Kotlin, JDK versions and whether the **New Architecture** is enabled. **[v2]**
9. Run the untouched app on an emulator **and** a physical device.
10. Add a README with exact setup and run commands.

Do not assume a globally installed Node or Java version is the one used by the terminal or Gradle.

### Environment configuration [v2]

Create `.env.example` (committed). Real `.env*` files are gitignored.

```text
APP_ENV=development
API_BASE_URL=https://api.example.invalid
REALTIME_URL=wss://realtime.example.invalid
FEATURE_REMOTE_CONTROL=false
```

Rules:
- Tools like `react-native-config` embed values **in plain text in the APK**. Only public values (URLs, feature flags) may go here.
- **No** API keys for your own backend, TURN secrets, signing keys, or third-party secret keys — ever.
- Third-party *public* client keys (e.g. Firebase config, Sentry DSN, Maps key) are allowed only if restricted in the provider console to the app's package name and SHA-256 signing certificate.
- Release builds must reject `http://` and `ws://` URLs at startup (fail closed).

## 6. Product roles and primary journeys

The same app supports two roles depending on the action.

### 6.1 Controller journey

1. User signs in.
2. User opens the dashboard.
3. User enters a remote device ID (and the target's one-time PIN if the target has PIN mode enabled) or selects a saved device. **[v2]**
4. App validates the input locally (format only).
5. App obtains a Play Integrity token and requests a session via REST with an `Idempotency-Key`. **[v2]**
6. App shows the request state: requesting, waiting for approval, accepted, rejected, expired, cancelled, or failed.
7. After acceptance, the app fetches short-lived ICE/TURN config and performs WebRTC setup.
8. On a real remote video track, the app opens the remote viewer.
9. (v2 release) The user uses only controls granted by the target and supported by its capabilities.
10. User disconnects.
11. App displays the session result returned by the service.

### 6.2 Remote-device (target) journey

1. User signs in and registers this phone.
2. Dashboard displays this phone's server-assigned device ID and status.
3. App asks for `POST_NOTIFICATIONS` (Android 13+) with an explanation, so requests can arrive in the background. **[v2]**
4. An incoming request arrives (socket if foregrounded, FCM heads-up notification if backgrounded). **[v2]**
5. App shows the anti-scam Accept flow (§6.4) with the verified controller identity.
6. User accepts (view-only by default) or rejects.
7. App explains screen capture, then requests MediaProjection consent through the platform dialog.
8. App shows a persistent sharing banner and a foreground notification with Stop.
9. User can stop immediately; Stop is handled natively first (kills capture/input), then tears down the session.
10. App shows the final state and a "Report this person" action. **[v2]**

### 6.3 Consent and permission requirements

- No incoming session is ever accepted silently or automatically.
- Do not auto-start screen capture.
- Explain every permission before requesting it; request at the point of use.
- Do not request Accessibility during onboarding. In the v2 release, request it only when the user enables remote control, with prominent disclosure.
- If capture permission is denied or revoked, stop the share workflow and explain how to retry.
- Viewing and control are separate grants. Control is **off by default** and granted per session. **[v2]**
- Always provide an obvious stop/disconnect action on both sides.

### 6.4 Anti-scam Accept flow [v2]

The most likely attacker is a scammer on a phone call persuading a real user to tap Accept. The Accept flow must resist social engineering:

- **Warning interstitial** before Accept on first use and for every request from an account not previously approved. Example copy: "Banks, UPI apps, telecom companies and the police will never ask you to install a screen-sharing app. If someone on a call asked you to do this, reject it."
- **Delayed Accept:** Accept disabled for ~5 seconds, then requires a deliberate gesture (press-and-hold, or typing a 4-digit code shown on screen).
- **Verified identity:** show the controller's account name and account age as returned by the server; flag new accounts.
- **Optional call-in-progress warning** if the user grants the needed permission (explained, optional).
- **View-only default.** Remote control (v2 release) is a separate grant, revocable at any time.
- **Block account** and **"accept requests only from my own devices"** setting.
- **Report this person** on the session-ended screen.
- Inform users that banking/UPI apps appear black during sharing — this is expected and protective.

## 7. Screen inventory and acceptance criteria

All screens support loading, empty, error and offline states where relevant. Sensitive screens set `FLAG_SECURE` (§17.7).

### 7.1 Splash / app initialization
- Brand mark, load non-sensitive config, attempt silent token refresh using the Keychain refresh token, route accordingly.
- Acceptance: no long blocking work on the UI thread; failed restoration routes to login and clears the vault; no token printed to logs; release build with non-HTTPS/WSS config fails closed with an error screen. **[v2]**

### 7.2 Onboarding (lightweight)
- Explain controller vs target use, owner approval, and scam awareness ("never accept a request because someone on a call told you to"). **[v2]**
- Acceptance: skippable; no permission requested.

### 7.3 Login
- Fields: identifier (as agreed with backend), password, show/hide.
- Actions: sign in, go to register, forgot password only if supported.
- Validation: required fields, email format if email, mapped server errors, no duplicate submissions.
- **[v2]** `FLAG_SECURE`; generic error for bad credentials (no "user does not exist"); handle server rate-limit responses (429) with a wait message; Play Integrity token attached to the login request.

### 7.4 Registration
- Fields per backend contract only. Client validation, password confirmation if required, loading/error states.
- **[v2]** `FLAG_SECURE`; password strength guidance matching server policy; Play Integrity token attached.

### 7.5 Dashboard
- Account summary, current device name, server-assigned device ID, online/offline/connecting, connect action, my devices, incoming request indicator, recent sessions, settings.
- **[v2]** Notification-permission prompt card (Android 13+) with explanation; "PIN mode" toggle showing a one-time PIN when enabled.
- Acceptance: device ID never generated locally; copy ID with confirmation; status from real realtime state; designed empty/offline states.

### 7.6 Connect to device
- Device ID input, optional PIN input **[v2]**, connect button, saved devices.
- Normalize separators/spaces; validate format only after backend confirms it; prevent empty/repeat submissions; show lifecycle states; cancel while waiting if supported.
- Acceptance: invalid IDs make no network request; no success claimed before server acknowledgement; understandable unknown/offline/blocked/rate-limited errors. **[v2]**

### 7.7 My devices
- Name, appropriately displayed ID, status, last seen, current-device marker, rename/remove if supported.
- **[v2]** Removing a device must revoke its tokens and sockets server-side; removing the current device logs out.
- Acceptance: server is source of truth (TanStack Query); loading/empty/stale/error states; destructive actions confirmed.

### 7.8 Incoming request
- Verified requester identity and account age **[v2]**, target device, expiry countdown if provided, anti-scam flow (§6.4), Accept/Reject.
- Acceptance: only the target can approve; expired/rejected/cancelled requests cannot be accepted (also enforced server-side); duplicate events and duplicate push notifications produce one dialog; background behaviour via FCM is documented honestly. **[v2]**

### 7.9 Permission explanation and capture preparation
- What will be shared, that Android shows its own dialog, that the user may choose a single app (Android 14 QPR2+), that `FLAG_SECURE` apps appear black. Start / cancel. **[v2]**
- Acceptance: native/WebRTC layer is the source of truth for permission state; development-unavailable state if absent; never simulate a grant.

### 7.10 Remote viewer
- Remote video, device name/ID, connection quality where measured, reconnecting state, full-screen toggle, toolbar, disconnect.
- **[v2]** `FLAG_SECURE` (prevents the controller screenshotting/recording the other person's screen); placeholder for a future verification code.
- Acceptance: render only after a real track; handle rotation, aspect ratio, resizing, safe areas, black frames, stream end, connection loss; no fake content in production.

### 7.11 Remote interaction toolbar (v2 release only)
- Tap, swipe/scroll, Back, Home, Recents, text entry, fit/original size — each subject to the target's capabilities **and** the target user's control grant.
- **[v2]** Send **normalized coordinates (0–1)** relative to the displayed video frame plus frame rotation; the target maps to real pixels.
- **[v2]** Send input over the WebRTC **data channel**, never the signaling socket.
- Acceptance: each control capability-gated with an explanation when disabled; nothing sent unless the session is active and control is granted; controller can stop interaction immediately. Controller gating is UX only — the target enforces (§17.6).

### 7.12 Session history
- Remote device, role, start/end, duration, final status. From the API, paginated, with empty/loading/error states. Never store screen content.

### 7.13 Settings and security
- Account info, app version, device name, permission status, notification preferences, sign out, privacy/security info, support/about.
- **[v2]** Relay-only connection toggle (hides IP from peer); "accept requests only from my devices"; blocked accounts; PIN mode; account deletion; active sessions/devices list with revoke.
- Acceptance: sign out calls server logout, then clears vault, query cache, stores and socket; permission status refreshed on focus; nothing implies Android restrictions can be bypassed.

## 8. Navigation structure

```text
RootNavigator
├── AuthStack
│   ├── Login
│   ├── Register
│   └── ForgotPassword (only if supported)
└── AppStack
    ├── MainTabs
    │   ├── Home
    │   ├── Devices
    │   ├── Sessions
    │   └── Settings
    ├── ConnectDevice
    ├── IncomingRequest        (reachable from FCM notification tap)  [v2]
    ├── ScamWarning            [v2]
    ├── PermissionPreparation
    └── RemoteViewer
```

Requirements:
- Type every route and parameter. **Never pass tokens, PINs or credentials as navigation params.** **[v2]**
- Prevent unauthenticated access to app routes.
- Logout resets navigation.
- Confirm before leaving an active session; handle Android back deliberately.
- Deep links / notification taps carry only opaque IDs; details are fetched over authenticated REST. **[v2]**

## 9. Source structure

```text
MobileDesk/
├── android/
├── ios/                          # reserved; not in initial release
├── contracts/                    # [v2]
│   ├── openapi.yaml
│   └── asyncapi.yaml
├── spike/                        # [v2] Milestone 1 only; deleted after M1 report
│   └── signaling-server/
├── src/
│   ├── app/            (AppProviders.tsx, bootstrap.ts)
│   ├── navigation/     (RootNavigator, AuthNavigator, AppNavigator, types.ts)
│   ├── features/
│   │   ├── auth/  dashboard/  devices/  connection/
│   │   ├── incoming-request/  remote-viewer/  sessions/  settings/
│   ├── components/     (common/, forms/, feedback/)
│   ├── services/
│   │   ├── api/        (httpClient.ts, apiErrors.ts, endpoints.ts, generated/)
│   │   ├── auth/       (tokenVault.ts, tokenProvider.ts)            [v2]
│   │   ├── integrity/  (playIntegrity.ts)                           [v2]
│   │   ├── push/       (fcm.ts)                                     [v2]
│   │   ├── realtime/   (realtimeClient.ts, realtimeEvents.ts, realtimeSchemas.ts)
│   │   ├── webrtc/     (peerConnectionManager.ts, mediaStreamManager.ts, webrtcTypes.ts)
│   │   ├── native/     (remoteDeviceNative.ts, nativeTypes.ts, mockRemoteDeviceNative.ts)
│   │   └── logging/    (logger.ts with redaction)                   [v2]
│   ├── session/        (sessionMachine.ts, sessionMachine.test.ts)   [v2]
│   ├── store/          (authStore.ts, uiStore.ts)
│   ├── theme/  hooks/  types/  utils/
│   └── config/         (env.ts, featureFlags.ts)
├── __tests__/
├── docs/
├── .env.example
├── .gitignore
├── README.md
└── package.json
```

Do not create empty abstractions without a use case.

## 10. Client-side state model

**[v2] Split:** server data (devices, history, profile) lives in **TanStack Query**. Zustand holds only client state. The live session lives in the **session state machine**.

### Auth state (Zustand)
```ts
type AuthState = {
  status: 'unknown' | 'authenticated' | 'unauthenticated';
  user: UserSummary | null;
  // access token is NOT stored here; it lives in tokenProvider memory only
};
```

### Device (from API via TanStack Query)
```ts
type DeviceStatus = 'unknown' | 'online' | 'offline' | 'connecting';
type Device = {
  id: string;            // server-assigned
  name: string;
  status: DeviceStatus;
  isCurrentDevice: boolean;
  lastSeenAt?: string;
};
```

### Session state machine [v2]
```ts
type SessionStatus =
  | 'idle'
  | 'requesting'
  | 'waiting_for_approval'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled'          // [v2] added
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'ended'
  | 'failed';

type SessionRole = 'controller' | 'target';

type RemoteSession = {
  id: string;
  role: SessionRole;
  targetDeviceId: string;
  controllerDeviceId: string;
  status: SessionStatus;
  controlGranted: boolean;   // [v2] false unless target explicitly granted (v2 release)
  startedAt?: string;
  endedAt?: string;
};
```

Rules:
- Implement transitions as an explicit table; illegal transitions are rejected and logged (redacted). Terminal states (`rejected`, `expired`, `cancelled`, `ended`, `failed`) never transition back to active states.
- Every event carries a `sessionId`; events for a different or already-terminal session are dropped.
- Unit-test every legal and a representative set of illegal transitions.
- Access token in memory only; refresh token in Keychain only. Nothing sensitive in AsyncStorage/MMKV/persisted Zustand.
- Never persist WebRTC objects, MediaStreams, sockets or native handles.
- Clear session data on terminal state and on logout.

## 11. API integration contract

**[v2] Contract-first:** before Milestone 3, write `contracts/openapi.yaml` with the backend owner and generate types into `src/services/api/generated/`. Validate responses at runtime with Zod.

Provisional operations (confirm with backend):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Register (with Play Integrity token) |
| POST | `/api/auth/login` | Sign in (with Play Integrity token) |
| POST | `/api/auth/refresh` | Rotate refresh token, get new access token |
| POST | `/api/auth/logout` | Revoke refresh token family server-side |
| GET | `/api/integrity/nonce` | **[v2]** One-time nonce for Play Integrity |
| POST | `/api/devices/register` | Register this phone (with integrity token, FCM token) |
| GET | `/api/devices` | List account devices |
| GET | `/api/devices/:deviceId` | Device details |
| DELETE | `/api/devices/:deviceId` | **[v2]** Remove device; revokes its tokens and sockets |
| PUT | `/api/devices/:deviceId/push-token` | **[v2]** Update FCM token |
| POST | `/api/sessions/request` | Request session (`Idempotency-Key`, integrity token, optional PIN) |
| GET | `/api/sessions/:sessionId` | **[v2]** Fetch request details (used after push tap) |
| POST | `/api/sessions/:sessionId/accept` | Accept (body: `{ controlGranted: false }` in v1) |
| POST | `/api/sessions/:sessionId/reject` | Reject |
| POST | `/api/sessions/:sessionId/cancel` | **[v2]** Controller cancels pending request |
| POST | `/api/sessions/:sessionId/disconnect` | End session |
| POST | `/api/sessions/:sessionId/report` | **[v2]** Report abuse |
| GET | `/api/sessions/history` | History (paginated) |
| GET | `/api/webrtc/ice-config?sessionId=` | Short-lived ICE/TURN config, only for parties of an accepted session |
| POST | `/api/realtime/ticket` | **[v2]** Single-use 30 s socket ticket |
| DELETE | `/api/account` | **[v2]** Account deletion |

Implementation requirements:
- One configured Axios instance; base URL from config; no URLs in screens.
- Bearer token injected from `tokenProvider` (memory).
- **Single-flight refresh** (see §17.3); refresh endpoint never triggers refresh; on refresh failure force logout.
- Normalize errors into typed client errors (network, timeout, 401, 403, 404, 409, 429, 5xx, validation).
- Timeouts and `AbortController` cancellation.
- **Never blindly retry** non-idempotent session actions; send `Idempotency-Key` on session creation and accept. **[v2]**
- Never log authorization headers, bodies of auth endpoints, ICE configs, or SDP.

## 12. Realtime client contract

**[v2]** Document events in `contracts/asyncapi.yaml`. Use Socket.IO only if the backend does; otherwise native WebSocket. Do not mix.

Events (to be confirmed):

```text
device:presence
session:incoming
session:accepted
session:rejected
session:cancelled
session:expired
session:ended
webrtc:offer
webrtc:answer
webrtc:ice-candidate
```

Requirements:
- **WSS only.**
- **[v2] Authenticate with a single-use ticket** from `POST /api/realtime/ticket` sent in the handshake payload. **Never put the JWT in the URL/query string.** Fetch a new ticket on every (re)connect.
- Reconnect with bounded exponential backoff and jitter (cap ~30 s).
- Expect the server to close the socket when the access token expires or is revoked; reconnect with a fresh ticket after refresh.
- Validate every inbound event with Zod; drop and log (redacted) malformed, unknown, or unrelated-session events.
- Deduplicate by event ID / session ID.
- Socket connected ≠ WebRTC connected.
- Show offline/reconnecting UI.

```ts
const socket = io(env.REALTIME_URL, {
  transports: ['websocket'],
  autoConnect: false,
  auth: async (cb) => cb({ ticket: await realtimeApi.fetchTicket() }),
  reconnectionDelayMax: 30_000,
  randomizationFactor: 0.5,
});
```

### 12.1 Push notifications (FCM) [v2]

- Register the FCM token at device registration and on token refresh (`PUT /api/devices/:id/push-token`).
- The server sends a **high-priority data message** containing only `{ type: 'session_request', sessionId }` — no names, no PII.
- The client shows a heads-up notification (channel with high importance). Tapping it opens `IncomingRequest`, which connects the socket and fetches details via `GET /api/sessions/:sessionId`.
- Do not use full-screen intents.
- Deduplicate push + socket deliveries of the same request.
- If notification permission is denied, the dashboard explains that requests only arrive while the app is open.

## 13. WebRTC client integration

Responsibilities:
1. Fetch authorized, short-lived ICE/TURN config for the session.
2. Create the peer connection (`iceTransportPolicy: 'relay'` when the relay-only setting is on). **[v2]**
3. Exchange offer/answer/candidates via the realtime client.
4. **Target:** obtain the screen track — **[v2] first evaluate `mediaDevices.getDisplayMedia()` from `react-native-webrtc`** (MediaProjection + foreground service of type `mediaProjection`). Fall back to a custom native capture source only if the spike shows it is necessary.
5. **Controller:** receive and render the remote video track.
6. **[v2]** For text legibility, prefer resolution over frame rate: `degradationPreference: 'maintain-resolution'`; cap frame rate (~10–15 fps on poor links).
7. **[v2] (v2 release)** Open an ordered, reliable data channel for input events.
8. Monitor connection/ICE state; recover or show failure.
9. On `ended`, `failed`, logout, unmount, or app kill: stop all tracks, close data channel and peer connection, clear references.

Important:
- WebRTC does not capture another app's screen by itself; capture needs MediaProjection.
- Verify `react-native-webrtc` with the selected RN version and New Architecture in the spike.
- **[v2]** Reserve a UI slot for a future short verification code derived from both DTLS fingerprints (defends against a compromised signaling server).
- Do not claim end-to-end operation until tested on two physical devices on different networks, including via TURN.

## 14. Android-native integration boundary

The app consumes a narrow, typed native interface. **[v2]** If the spike validates `getDisplayMedia()`, screen capture is handled by `react-native-webrtc` plus its foreground service, and the custom native module mainly covers **capabilities, permission state events and remote input (v2 release)**.

```ts
type CapturePermissionState = 'unknown' | 'granted' | 'denied' | 'unavailable';

type RemoteCapabilities = {
  screenCapture: boolean;
  remoteTap: boolean;
  remoteSwipe: boolean;
  navigationActions: boolean;
  textInput: boolean;
};

type NormalizedPoint = { x: number; y: number }; // 0..1, relative to the shared frame  [v2]

interface RemoteDeviceNative {
  getPermissionState(): Promise<CapturePermissionState>;
  getCapabilities(): Promise<RemoteCapabilities>;
  // v2 release — the native layer validates against ITS OWN session state:  [v2]
  armInputForSession(sessionId: string, controlGranted: boolean): Promise<void>;
  disarmInput(): Promise<void>;           // called first on Stop; must be idempotent
}

type NativeEvent =
  | { type: 'capture_stopped'; reason: 'user' | 'system' | 'revoked' }
  | { type: 'service_stopped' }
  | { type: 'rotation_changed'; rotation: 0 | 90 | 180 | 270 }
  | { type: 'accessibility_disabled' };
```

Client requirements:
- Mock adapter for UI development and tests, visibly labelled as mock.
- Missing native module → typed `unavailable`, never a crash.
- Never fake a granted permission.
- No arbitrary native command execution.
- Capability-gate every control.
- Handle revocation, capture stopped, service stopped, rotation and accessibility disabled.

## 15. UI/UX and design system

- Professional remote-support look; dark-first; high contrast; consistent status colours never used alone to convey status.
- Large connect/disconnect/stop actions; uncluttered viewer; persistent active-session indicator.

Components: `AppButton`, `AppTextInput`, `ScreenContainer`, `StatusBadge`, `DeviceCard`, `SessionCard`, `LoadingView`, `EmptyState`, `ErrorState`, `ConfirmDialog`, `PermissionExplanation`, `ConnectionStatusBar`, **`ScamWarning` [v2]**, **`HoldToConfirmButton` [v2]**, **`ActiveSessionBanner` [v2]**.

Accessibility: labels, ≥48 dp touch targets, screen-reader status announcements, font scaling, landscape-usable viewer controls.

## 16. Error and lifecycle handling

Handle explicitly: no internet; API timeout; expired access token; refresh-token reuse/revocation (forced logout with explanation) **[v2]**; integrity check failure (generic message, no detail) **[v2]**; rate-limited (429) **[v2]**; invalid device ID or PIN; device offline; request rejected/expired/cancelled; duplicate request (socket + push); realtime lost; WebRTC failed; TURN unavailable; capture permission denied; capture stopped by OS/user; single-app share / black frames **[v2]**; native module unavailable; background/foreground; remote rotation; controller app closed mid-session; target disconnected; logout during active session; device removed remotely **[v2]**.

For every error: preserve a safe state; understandable message; valid recovery action; no leakage of tokens or session data; terminated sessions cannot send interaction commands.

## 17. Security requirements [v2 — rewritten]

**Principle: the app is untrusted.** Anyone can decompile it, read every string, patch out checks, and call the API directly. Security must hold even against a modified copy of the app.

### 17.1 Where every secret lives

| Item | In APK? | Location | Notes |
|---|---|---|---|
| API base URL, realtime URL | Yes (public) | Build config | Not secret |
| "API key" for own backend | **No** | Not created | Replaced by user JWT + Play Integrity |
| Public third-party keys (Firebase config, Sentry DSN, Maps) | Yes, restricted | Build config | Restrict by package name + SHA-256 cert |
| Third-party secret keys (payments, SMS, email) | **Never** | Backend only | App → backend → provider |
| Access token (JWT) | Runtime | **Memory only** | Lost on kill; restored via refresh |
| Refresh token | Runtime | **react-native-keychain** (Android Keystore) | Never AsyncStorage/MMKV/persisted state |
| TURN credentials | Runtime | Memory, per session | ~10 min, HMAC-derived server-side |
| JWT signing keys, TURN shared secret, DB credentials | **Never** | Backend secret manager | — |
| Release keystore | **Never in repo** | CI secret store / Play App Signing | — |

### 17.2 App attestation (replaces API keys)

1. App requests a one-time nonce (`GET /api/integrity/nonce`).
2. App requests a Play Integrity token with that nonce.
3. Server verifies with Google: package name, signing cert, device integrity, nonce.
4. Required at **login, registration, device registration, and session request** (not every call).
5. Failed verdict = risk signal (step-up, rate limit), not necessarily a hard block.

### 17.3 JWT and refresh-token design

- **Access token:** 10–15 min, asymmetric signature (EdDSA or RS256), claims `sub`, `deviceId`, `iss`, `aud`, `exp`, `iat`, `jti`. Server pins the algorithm.
- **Refresh token:** opaque random value, stored hashed server-side, **rotated on every use**, **reuse detection** revokes the entire family and forces re-login.
- **Device-bound:** each refresh token belongs to one registered device; removing a device revokes its tokens and sockets.
- Client never makes authorization decisions from JWT contents.
- **Logout:** call `/auth/logout`, then clear vault, TanStack Query cache, Zustand stores, session machine, socket, peer connection.
- **Phase 2:** Keystore-generated key pair per device; refresh requests signed (proof of possession).

```ts
// src/services/auth/tokenVault.ts
import * as Keychain from 'react-native-keychain';

const SERVICE = 'mobiledesk.refresh';

export const tokenVault = {
  async saveRefresh(token: string): Promise<void> {
    await Keychain.setGenericPassword('refresh', token, {
      service: SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },
  async readRefresh(): Promise<string | null> {
    const creds = await Keychain.getGenericPassword({ service: SERVICE });
    return creds ? creds.password : null;
  },
  async clear(): Promise<void> {
    await Keychain.resetGenericPassword({ service: SERVICE });
  },
};
```

```ts
// src/services/api/httpClient.ts (excerpt) — single-flight refresh, no loops
let refreshInFlight: Promise<string> | null = null;

http.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config as RetriableConfig | undefined;
  const isRefreshCall = original?.url === ENDPOINTS.refresh;
  if (!original || error.response?.status !== 401 || original._retried || isRefreshCall) {
    throw error;
  }
  original._retried = true;
  refreshInFlight ??= refreshTokens().finally(() => { refreshInFlight = null; });
  try {
    const accessToken = await refreshInFlight;
    original.headers.set('Authorization', `Bearer ${accessToken}`);
    return http(original);
  } catch {
    await useAuthStore.getState().forceLogout('session_expired');
    throw error;
  }
});
```

Verify the exact `react-native-keychain` and Axios APIs against installed versions.

### 17.4 WebSocket security
- WSS only; release builds refuse `ws://`.
- Single-use 30 s ticket in handshake; never JWT in URL.
- Server closes sockets on token expiry/revocation.
- Server authorizes **every** message: sender must be a party to `sessionId` and the session state must allow the event. Server never relays to an arbitrary client-supplied `deviceId`.
- Client validates every inbound event with Zod.
- Server rate-limits events per socket and per account.

### 17.5 WebRTC and TURN
- Media and data channels are DTLS-SRTP encrypted by default.
- TURN REST pattern: server issues `username = <expiry>:<userId>`, `credential = HMAC(secret, username)`, ~10 min TTL, only to the two parties of an accepted session.
- Relay-only option to hide IP addresses from the peer (consider default for cross-account sessions).
- Full teardown on terminal states.
- Future: DTLS-fingerprint verification code shown on both devices.

### 17.6 Target-side enforcement (most important rule)
The target phone executes input **only** if all are true, checked **in the native layer on the target**:
- Its own local session state is `connected` for that `sessionId`, approved by the local user on this device.
- The input arrived on that session's data channel.
- The local user granted control for this session (view-only by default).
- The local user has not pressed Stop. Stop calls `disarmInput()` **first**, then tears down the session.

Controller-side gating is UX only.

### 17.7 Android hardening
- `network_security_config.xml`: `cleartextTrafficPermitted="false"` in base config; cleartext only in `debug-overrides` for Metro.
- Optional public-key pinning with ≥2 pins (current + backup) and an `expiration` date.
- `FLAG_SECURE` on Login, Register, RemoteViewer (and any screen showing PINs).
- R8 enabled (`minifyEnabled true`), Hermes on, `debuggable false`, Play App Signing, keystore outside repo.
- `android:allowBackup="false"` (or backup rules excluding credentials); explicit `android:exported` on every component; no unused permissions.
- Redacting `logger` (redacts keys: `authorization`, `token`, `refresh`, `password`, `pin`, `sdp`, `candidate`, `credential`, `ticket`); `console.*` stripped in release; Sentry `beforeSend` scrubs the same keys.
- Root/emulator detection = weak signal only; Play Integrity is the real control.
- Lockfile committed; `npm audit` and gitleaks in CI; Dependabot; native dependencies reviewed.
- Standard: **OWASP MASVS** L1 self-assessment; external penetration test before public launch.

## 18. Testing strategy

### 18.1 Unit
Form validation; device ID normalization; API error normalization; auth transitions; **session state machine (legal + illegal transitions) [v2]**; realtime event validation and dedup (socket + push) **[v2]**; **single-flight refresh (10 parallel 401s → 1 refresh; refresh failure → logout) [v2]**; **logger redaction [v2]**; normalized coordinate mapping across aspect ratios/orientations; capability gating.

### 18.2 Component
Login/registration; dashboard states; device list; connect form; incoming request accept/reject; **scam warning + delayed Accept [v2]**; viewer disconnected/reconnecting; disconnect confirmation; settings and sign-out.

### 18.3 Integration
Login + token restoration against a test API; device registration and list; session request lifecycle; realtime delivery with tickets; **push → IncomingRequest flow [v2]**; WebRTC offer/answer/ICE with a test signaling service; native unavailable and permission denied.

### 18.4 Manual device tests (≥2 physical Android devices)
Same Wi-Fi; different Wi-Fi; Wi-Fi ↔ mobile data; network switching; TURN relay path; rotation; permission denial/revocation; single-app share (Android 14 QPR2+) **[v2]**; background/foreground; request while backgrounded (FCM) **[v2]**; disconnect from either side; low bandwidth/packet loss; mid-range hardware profiling.

### 18.5 Security tests [v2]
- Decompile the release APK (`apktool d`) and search for `secret`, `key`, `password`, `token`, `turn`: only public values found.
- Logcat capture during a full session: no tokens, SDP, ICE candidates, tickets.
- Replay an old `session:accepted` / `webrtc:offer` event: rejected.
- Attempt to accept an expired/cancelled request: rejected (client and server).
- Reuse a rotated refresh token: entire family revoked.
- (v2 release) A patched controller sending input without an accepted session or without control grant: **rejected by the target**.
- Stop on the target ends capture and input within 1 second even if the controller ignores the end event.

Never use a UI mock as evidence that capture or control works.

## 19. Performance requirements
- Responsive screens; isolate video rendering from dashboard state.
- Avoid app-wide rerenders on connection-quality events.
- Clean up listeners, sockets, tracks, peer connections; no retained streams.
- Paginate long lists; avoid polling when realtime presence exists.
- Show connection quality only when measured.
- Profile on a physical mid-range Android device.

## 20. Implementation milestones and gates [v2 — reordered]

Do not start a milestone until the previous **gate** passes.

### Milestone 0 — Repository and environment audit
Tasks: inspect repo and tooling; confirm framework/versions and New Architecture status; build and run untouched app; document.
**Gate:** untouched app builds and runs on a physical Android device; README has exact setup steps; no existing work overwritten.

### Milestone 1 — Risk spike (throwaway) [v2 NEW]
Tasks:
- `spike/signaling-server/`: ~100-line local Node WebSocket relay, no auth, never deployed.
- Minimal spike screens (behind a dev-only flag) on two physical phones: phone A captures via `react-native-webrtc` `getDisplayMedia()` with a `mediaProjection` foreground service; phone B renders.
- Test with a local/test TURN server; credentials kept in an uncommitted local file.
- Measure latency and text legibility on same Wi-Fi and on mobile data via TURN.
- Record: RN/New Architecture compatibility, required manifest entries, Android 14 behaviour, whether a custom capture module is needed.
**Gate:** legible stream on mobile data via TURN with measured latency, findings recorded in `docs/SPIKE_FINDINGS.md`. Then delete `spike/` code and the spike screens (keep the findings).
If the gate fails, stop and report; the architecture must be revisited before continuing.

### Milestone 2 — Foundation and security baseline [v2]
Tasks: strict TS, ESLint/Prettier; typed navigation with placeholder routes; theme and components; splash and onboarding; **redacting logger**; **`network_security_config.xml`**; **R8/Hermes release config**; **`FLAG_SECURE` utility**; **`allowBackup`/`exported` audit**; **console stripping in release**; **CI with tsc, lint, tests, `npm audit`, gitleaks**; `.env.example` and fail-closed URL check.
**Gate:** all routes navigate; CI green on every push; release build installs; small and large screen checked.

### Milestone 3 — Contracts and authentication [v2]
Tasks: `contracts/openapi.yaml` and `contracts/asyncapi.yaml` agreed with backend; generated types; Axios client with single-flight refresh; `tokenVault` (Keychain) and in-memory `tokenProvider`; Play Integrity client; login/registration UI and validation; restoration and full logout.
**Gate:** full auth flow against a test backend or a clearly labelled mock server; refresh-token reuse causes forced logout; no secret in plain storage (verified by inspection).

### Milestone 4 — Devices and push [v2]
Tasks: device registration (with FCM token and integrity token); server-assigned ID display; device list via TanStack Query; copy ID; remove device; presence via realtime with ticket auth; FCM setup, notification channel, permission card, push token updates.
**Gate:** device state sourced from API/realtime; a session-request push reaches a backgrounded target and opens `IncomingRequest`; loading/empty/offline/error states tested.

### Milestone 5 — Consent workflow [v2]
Tasks: session state machine with tests; connect-by-ID (+ optional PIN); session request with idempotency key; incoming request UI; **scam warning, delayed/hold-to-confirm Accept, verified identity**; accept/reject/cancel/expiry; realtime subscriptions with Zod validation and dedup; block/report.
**Gate:** two test clients complete request → approval through a test backend; duplicate, replayed and expired events rejected; nothing marked connected prematurely.

### Milestone 6 — View-only session end to end [v2]
Tasks: production-quality version of the spike path — ICE config retrieval, peer connection manager, signaling, `getDisplayMedia()` capture on target (or native fallback), viewer rendering, `FLAG_SECURE` on viewer, active-session banner + foreground notification + one-tap Stop, reconnect, full cleanup, relay-only setting.
**Gate:** two physical phones on different networks complete a view-only session including via TURN; Stop ends sharing within 1 second; tracks/peer connections cleaned up; network failures show accurate states.

### v1 RELEASE GATE — view-only remote assistance [v2]
- Security checklist (§18.5 and §25) passes.
- OWASP MASVS L1 self-assessment complete.
- Play Console declarations (foreground service, data safety, account deletion) prepared.
- Internal testing track build installed and tested.
- `KNOWN_LIMITATIONS.md` accurate.

### Milestone 7 — Remote control (v2 release) [v2]
Prerequisite: the native track has delivered the AccessibilityService implementation conforming to §14 and §17.6.
Tasks: read capabilities; control-grant UI on target with prominent disclosure; data channel; normalized coordinate mapping; capability-gated toolbar; disable all controls on authorization/session loss; Play accessibility disclosure and declaration materials.
**Gate:** only granted and supported actions execute; coordinate mapping tested across aspect ratios and orientations; **a patched controller is rejected by the target**; no control remains active after termination; Play approves the declaration.

### Milestone 8 — Penetration test and public launch [v2]
Tasks: external penetration test; MASVS review; DPDP privacy notice; account deletion verified; staged rollout plan; documentation reflects real capabilities.
**Gate:** no open critical or high findings; release build installed and tested; docs accurate.

## 21. Definition of MVP

**v1 MVP (view-only) [v2]** is complete when:
1. A user can sign in securely (JWT + rotating refresh, Keystore storage, Play Integrity).
2. A phone registers and shows its server-assigned device ID.
3. A second client requests access using that ID.
4. The target receives the request even when backgrounded (FCM) and accepts or rejects through the anti-scam flow.
5. The controller sees a real screen stream after approval and MediaProjection consent.
6. Either side can stop immediately; the target shows a persistent sharing indicator.
7. Network loss and termination are handled safely.
8. The app claims no unsupported capability (no remote control in v1).
9. Tests, security checks and Android release build pass.

**v2** adds remote control after Milestone 7's gate. A UI-only prototype is never the MVP.

## 22. Required documentation

```text
docs/
├── APP_ARCHITECTURE.md
├── SCREEN_AND_NAVIGATION_MAP.md
├── API_CONTRACT_ASSUMPTIONS.md          (links contracts/openapi.yaml)
├── REALTIME_EVENT_CONTRACT.md           (links contracts/asyncapi.yaml)
├── PUSH_NOTIFICATIONS.md                [v2]
├── WEBRTC_CLIENT_FLOW.md
├── NATIVE_INTEGRATION_INTERFACE.md
├── PERMISSIONS_AND_CONSENT.md           (incl. anti-scam flow)
├── SECURITY_ARCHITECTURE.md             [v2] (§17 as implemented)
├── BACKEND_SECURITY_REQUIREMENTS.md     [v2] (§24)
├── THREAT_MODEL.md                      [v2] (attackers: scammer, modified client, stolen phone, network attacker, compromised signaling)
├── SPIKE_FINDINGS.md                    [v2]
├── TEST_PLAN.md
└── KNOWN_LIMITATIONS.md
```

README: prerequisites, installation, Android setup, run, test, build, environment variables (public only), troubleshooting, current feature status.

## 23. Milestone reporting format

```text
MILESTONE:
STATUS: Complete / Blocked / Partial
GATE: Passed / Not passed — evidence:

IMPLEMENTED:
- ...

FILES CREATED:
- ...

FILES MODIFIED:
- ...

DEPENDENCIES ADDED:
- name@version — purpose — native code? — permissions — compatibility checked

COMMANDS EXECUTED:
- ...

TESTS:
- Passed:
- Failed:
- Not run:

MANUAL VERIFICATION:
- ...

SECURITY IMPACT:                       [v2]
- New secrets/credentials handled:
- New permissions:
- New endpoints/events:
- New stored data (where, encrypted?):
- New exported components:
- Logging reviewed for leaks: yes/no

BLOCKERS / ASSUMPTIONS:
- ...

NEXT MILESTONE:
- ...
```

If blocked by missing backend or native functionality: finish independently verifiable client work; add a typed adapter and labelled mock; document the exact missing contract; never fabricate a connection or stream; continue with independent tasks.

## 24. Backend security requirements (hand to backend owner) [v2]

The client depends on these. Record them in `docs/BACKEND_SECURITY_REQUIREMENTS.md` and track confirmations.

- **Passwords:** Argon2id (or bcrypt cost ≥12); login rate limits per account and per IP with progressive delay; optional TOTP later.
- **Tokens:** 10–15 min asymmetric JWT, pinned algorithm; opaque, hashed, rotating, device-bound refresh tokens with reuse detection; server-side revocation on logout/device removal.
- **Device IDs:** CSPRNG-generated, non-sequential, ≥9–10 digits; knowing an ID grants nothing.
- **Sessions:** server-side state machine; only the target device's authenticated session may accept; requests expire (~60 s); idempotency keys on create/accept.
- **Abuse limits:** session requests rate-limited per controller, per IP and per target (e.g. ~5/hour to unfamiliar devices); block lists; optional target PIN; account age exposed to target.
- **Realtime:** single-use 30 s tickets; socket closed on token expiry/revocation; every signaling message authorized against session membership and state; per-socket rate limits.
- **TURN:** coturn `use-auth-secret`, ~10 min credentials only for parties of an accepted session; `denied-peer-ip` for private/internal ranges.
- **Play Integrity** verification at login, registration, device registration, session request.
- **Push:** FCM payloads carry only opaque IDs.
- **Audit log:** session start/end, parties, IP, duration; never screen content; defined retention.
- **Transport and secrets:** TLS 1.2+; secrets in a secret manager; nothing in committed env files.
- **Privacy:** account deletion endpoint; DPDP Act-aligned privacy notice; post-session summary email to the target account.

## 25. Release security checklist [v2]

Run before every build that leaves the developer machine, including internal test APKs.

- [ ] Decompiled APK contains only public values (no secrets, keys, tokens, TURN credentials).
- [ ] `.env*` (except `.env.example`), keystores and production `google-services.json` are gitignored; gitleaks clean on history.
- [ ] Refresh token only in Keychain; access token only in memory; nothing sensitive in AsyncStorage/MMKV/persisted state.
- [ ] Release refuses `http://` and `ws://`; pins (if used) have a backup and an expiry.
- [ ] No `console.*` in release; logcat during a full session shows no tokens, SDP, ICE candidates or tickets.
- [ ] Logout and device removal end socket, peer connection and tokens (verified server-side).
- [ ] (v2 release) Patched controller input without accepted session/grant is rejected by the target.
- [ ] Stop on the target ends capture and input within 1 second.
- [ ] Expired/rejected/cancelled requests cannot be accepted, including via replayed events.
- [ ] `FLAG_SECURE` on Login, Register, RemoteViewer; `allowBackup` off; explicit `exported` everywhere.
- [ ] Scam warning and delayed Accept work; control off by default.
- [ ] `npm audit` has no high/critical issues; native dependencies reviewed.
- [ ] OWASP MASVS L1 self-assessment done; external pen test before public launch.

## 26. First task for the coding agent

Start with **Milestone 0 only**.

1. Inspect the repository and environment.
2. Determine whether a React Native project exists.
3. Check Node/npm, JDK, Android SDK, Android Studio, `adb`.
4. If no app exists, create a bare React Native TypeScript app using the current official Community CLI procedure.
5. Run the untouched app on an emulator and a physical device.
6. Record versions, New Architecture status, and compatibility issues.
7. Create/update the README with exact setup and run instructions.
8. Report using §23, including SECURITY IMPACT.

**Do not start backend development. Do not implement Kotlin AccessibilityService or input injection. Do not start Milestone 1 (risk spike) until Milestone 0's gate passes.**

---

## Final instruction

Build MobileDesk as a maintainable, secure, Android-first React Native client. Treat the app as untrusted, keep every secret on the server, enforce consent and control on the target device, design the Accept flow against scams, and prove the riskiest technology first. Ship view-only remote assistance as v1; add remote control only after its own security and policy gate.
