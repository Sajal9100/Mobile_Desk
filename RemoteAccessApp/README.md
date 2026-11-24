# MobileDesk (RemoteAccessApp)

Android-first remote-device assistance app (React Native client). The full
implementation spec is [`MobileDesk_Execution_Plan_v2.md`](MobileDesk_Execution_Plan_v2.md).

> **Status: Milestone 0 (environment audit).** The app is still the untouched
> React Native template. No MobileDesk features exist yet — see
> [Feature status](#feature-status).

## Versions this project is pinned to

| Component | Version |
|---|---|
| React Native / React | 0.88.1 / 19.3.0 |
| TypeScript | 6.0.3 (`strict` via `@react-native/typescript-config`) |
| Architecture | **New Architecture only** (`newArchEnabled=true`), Hermes on, edge-to-edge on |
| Gradle / Android Gradle Plugin / Kotlin | 9.4.1 / 9.2.1 / 2.2.0 |
| compileSdk / targetSdk / minSdk | 37 / 36 / 24 |
| Build tools / NDK / CMake | 37.0.0 / 27.1.12297006 / 3.22.1 |
| JDK | 17 (Temurin 17.0.21) |
| Node / npm | >= 22.11 required (developed on 26.13.1 / 11.20.0) |

## Prerequisites

- Node.js >= 22.11 and npm
- JDK 17, with `JAVA_HOME` pointing at it
- Android Studio with these SDK Manager components: Platform 37, Build-Tools
  37.0.0, NDK 27.1.12297006, CMake 3.22.1, Platform-Tools, Emulator
- `ANDROID_HOME` set (e.g. `C:\Users\<you>\AppData\Local\Android\Sdk`) and
  `%ANDROID_HOME%\platform-tools` + `%ANDROID_HOME%\emulator` on `PATH`
- A device or emulator visible in `adb devices`
- Not needed: Yarn, Watchman, Ruby/CocoaPods (iOS is out of scope)

Do not assume the `java` on your `PATH` is the one Gradle uses; check
`java -version` and `echo %JAVA_HOME%` in the same terminal you build from.

## Install

```sh
npm ci
```

## Run (development)

Terminal 1 — Metro:

```sh
npm start
```

Terminal 2 — build and install on the connected device/emulator:

```sh
npm run android -- --active-arch-only
```

`--active-arch-only` builds just the connected device's ABI, which is much
faster than the default four ABIs. With more than one device attached, choose
one: `npm run android -- --device <serial>` (serials from `adb devices`).
If Metro is already running, add `--no-packager`.

### Physical device

1. Enable Developer options and USB debugging.
2. Connect by USB and accept the RSA prompt; confirm with `adb devices`.
3. Some OEMs (vivo/iQOO, Xiaomi, Oppo) show an extra "Install via USB" prompt
   on the phone during install — accept it or the install will fail.
4. If the app can't reach Metro: `adb reverse tcp:8081 tcp:8081`.

### Emulator

An `AVD` named `Medium_Phone_API_37.0` (Android 17, Google Play, x86_64) is
used for testing. Start it from Android Studio or:

```sh
emulator -avd Medium_Phone_API_37.0
```

On Android 17, debug builds ask for **"Nearby devices"** on first launch. That
is `ACCESS_LOCAL_NETWORK`, which the React Native *debug* manifest adds so the
app can reach Metro. Tap Allow; without it the screen stays blank. It is not
present in release builds.

## Test, lint, typecheck

```sh
npx tsc --noEmit     # typecheck
npm run lint         # ESLint
npm test             # Jest
```

## Build

```sh
cd android
.\gradlew.bat assembleDebug      # android/app/build/outputs/apk/debug/app-debug.apk
```

Release builds are not configured yet: they are currently signed with the
debug keystore and R8 is off. Both are fixed in Milestone 2.

## Environment variables

None yet. `.env.example` (public values only: API/realtime URLs, feature
flags) arrives in Milestone 2. Secrets never go in the app bundle.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `'gradlew.bat' is not recognized` when running `npm run android` | The environment variable `NoDefaultCurrentDirectoryInExePath=1` is set in that shell, so Windows won't look in the current directory. Unset it (`Remove-Item Env:NoDefaultCurrentDirectoryInExePath` in PowerShell) or run `cd android; .\gradlew.bat app:installDebug` directly. |
| `EADDRINUSE: address already in use :::8081` | Another Metro is already running (check `Get-NetTCPConnection -LocalPort 8081`). Reuse it with `--no-packager`, or stop it. |
| `npx react-native info` says "Android SDK: Not Found" | CLI detection quirk; if `adb` works and `ANDROID_HOME` is set, builds are unaffected. |
| Blank white screen on the Android 17 emulator | Grant the "Nearby devices" prompt (see Emulator). |
| `adb shell screencap -p /sdcard/x.png` fails in Git Bash | Git Bash rewrites `/sdcard/...` paths. Use PowerShell, or prefix with `MSYS_NO_PATHCONV=1`. |
| Gradle out-of-memory | Raise `org.gradle.jvmargs` in `android/gradle.properties`. |
| Native (CMake/NDK) build fails with path-too-long errors | Windows long paths are off by default. Enable `LongPathsEnabled` (admin) or move the repo to a shorter path. |

## Feature status

| Milestone | Status |
|---|---|
| M0 Repository and environment audit | In progress — app runs on phone + emulator |
| M1 Risk spike (capture to WebRTC to viewer) | Not started |
| M2 Foundation and security baseline | Not started |
| M3 Contracts and authentication | Not started |
| M4 Devices and push | Not started |
| M5 Consent workflow | Not started |
| M6 View-only session end to end | Not started |
| M7 Remote control | Blocked on native AccessibilityService |
| M8 Penetration test and launch | Not started |
