# VEYRA

A cinematic, responsive frontend for a fictional streaming service. The web app runs as a Vite + React single-page application and is packaged for Android with Capacitor.

## Run locally

```bash
npm ci
npm run dev
```

Vite prints the local development URL. To make a production web build:

```bash
npm run build
```

## Android debug APK

This repository includes the generated Capacitor Android project and a GitHub Actions workflow (`Android APK`) that builds a debug APK on pushes, pull requests to `main`, and manual dispatches.

Requirements for a local Android build: Node.js 22, JDK 21, and the Android SDK (platform/build tools 35).

```bash
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. GitHub Actions uploads the same file as the `veyra-debug-apk` artifact. Release signing is intentionally not configured; add a protected keystore and signing secrets before distributing a release build.

## Experience

- Mobile-first Home, Discover, Search, details, series seasons/episodes, My List, Continue Watching, Watch History, Downloads, Profile, Settings, Devices, Notifications, and offline screens.
- Branded splash and welcome/sign-in/sign-up/forgot-password flows.
- Mock playback controls, quality/subtitle/audio sheets, seeking, buffering/error states, and a next-episode overlay.
- A separate TV layout with a focus ring and keyboard/D-pad navigation (`Arrow` keys, `Enter`, `Escape`/`Backspace`, and space for play/pause).
- Original local key-art assets, responsive poster rails, skeleton states, empty states, and an installable/offline-cached web shell.
- Mock preferences, list, downloads, history, and notifications are persisted in local storage.

## Intentional mock behavior

No backend, real authentication, content licensing/catalog service, account sync, recommendations, subtitles, audio tracks, streaming source, or actual file downloads are connected. Player controls operate a mock preview timeline over local key art; download actions update mock progress. The service worker caches the web shell and same-origin assets after the first online visit; remote services and any uncached content remain unavailable offline.
