# VEYRA

VEYRA is a cinematic React/Vite application packaged for Android with Capacitor. It now consumes catalog and metadata endpoints through a dedicated MovieBox service layer; it does not bundle a sample movie catalog or simulate playback/download progress.

## Configure the catalog API

Create a local environment file from the example. It sets the metadata API base to `https://movieboxapi.vercel.app`; use this deployment only if its operator authorizes your use:

```bash
cp .env.example .env.local
```

`VITE_MOVIEBOX_API_BASE_URL` is public configuration compiled into the web app and Android assets. Do not put upstream credentials, private tokens, or secrets in any `VITE_*` variable. Keep them on the API server. See [the integration audit](docs/MOVIEBOX_INTEGRATION.md) for the endpoint mapping and the media/security boundary.

## Run locally

```bash
npm ci
npm run dev
```

Vite binds to `0.0.0.0`. Without a configured API base URL, the app fails closed and shows an API configuration state rather than rendering fixture content.

## Checks and production build

```bash
npm test
npm run build
```

## Android debug APK

Requirements for a local Android build: Node.js 22, JDK 21, and Android SDK platform/build tools 35.

```bash
npm ci
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. The GitHub Actions `Android APK` workflow builds and uploads the debug artifact. Release signing is not configured.

## Current feature status

- Home, Discover, Search, item details, and related-title rails use normalized results from configured catalog endpoints.
- My List stores compact catalog references locally.
- History and Continue Watching contain no seeded entries and only become meaningful when verified playback is integrated.
- Playback, quality switching, subtitles, downloads, and offline media are intentionally disabled. The supplied MovieBox repository includes upstream identity/referrer spoofing and public proxy relays; its deployment and media authorization could not be verified. VEYRA does not request those media routes, invent URLs, or simulate media controls/progress.
- The service worker caches only the VEYRA same-origin app shell/assets; remote API data and media are not available offline.

## Verification

The configured metadata host returned successful read-only homepage and search JSON responses during this update, but browser CORS, stable availability, Android runtime networking, streaming, downloads, subtitles, offline playback, and real-device behavior are **NOT VERIFIED**. See [docs/MOVIEBOX_INTEGRATION.md](docs/MOVIEBOX_INTEGRATION.md).
