# VEYRA

VEYRA is a cinematic React 19 + Vite streaming app, packaged for Android with Capacitor. It browses and streams the **ZST Labs MovieBox API** (`https://api.zstlab.cyou`): a real catalog, real progress, real playback in a standard `<video>` element, and best-effort downloads with honest states.

- No auth, no accounts, no device management, no push notifications, no multi-device sync, no backend service.
- My List, history, download attempts and preferences live in `localStorage` on the device.
- VEYRA never falls back to sample titles, never simulates playback with a timer, and never opens an external video site.

## Configure the catalog API

Copy the example file and set your key:

```bash
cp .env.example .env.local
```

```dotenv
VITE_MOVIEBOX_API_BASE_URL=https://api.zstlab.cyou
VITE_ZST_API_KEY=your-zst-labs-api-key
```

> **The key is public.** There is no backend in this project, so `VITE_*` values are compiled straight into the web bundle **and** the Android APK. Anyone with the app can read them. The key is sent on every catalog request as the `x-api-key` header. Use your own key, keep the repository/build private, and rotate the key if it leaks.

The Android workflow (`.github/workflows/android-apk.yml`) passes both values to the build:

```yaml
env:
  VITE_MOVIEBOX_API_BASE_URL: https://api.zstlab.cyou
  VITE_ZST_API_KEY: ${{ secrets.VITE_ZST_API_KEY }}
```

## Run locally

```bash
npm ci
cp .env.example .env.local   # then fill in your key
npm run dev
```

Vite binds to `0.0.0.0`. Without a configured base URL or key, the app fails closed: catalog screens show an explicit configuration message with a retry, and no fixture content is rendered.

## Checks

```bash
npm test          # service-layer unit tests (normalizer, media, subtitles, client)
npm run test:ssr  # renders every screen through Vite SSR with real catalog shapes
npm run build     # production bundle
npm run verify    # all three
```

## Android debug APK

Requirements: Node.js 22, JDK 21, Android SDK platform and build tools 35.

```bash
npm ci
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK lands in `android/app/build/outputs/apk/debug/app-debug.apk`. The GitHub Actions `Android APK` workflow runs the unit tests, the render smoke test, the web build and the Gradle build, then uploads the debug artifact. Release signing is not configured.

## What is wired to the provider

| Screen | Provider route |
| --- | --- |
| Home rails, hero, provider notice | `GET /api/homepage` |
| Trending rail | `GET /api/trending?page=0&perPage=18` |
| Hot movies & series rail | `GET /api/hot-movies-series` |
| Search idle state | `GET /api/popular-searches` |
| Search + load more | `GET /api/search?query=&subjectType=ALL\|MOVIES\|TV_SERIES&page=&perPage=` (`q` is used only if `query` returns nothing) |
| Search suggestions | `GET /api/search-suggestion?q=` |
| Details, seasons, cast | `GET /api/item-details?subjectId=&detailPath=` |
| "More like this" | `GET /api/recommendations?subjectId=` |
| Playback and captions | `GET /api/media?subjectId=&detailPath=&season=&episode=` |

Movies use `season=0&episode=0`; series use the real season and episode numbers the provider returns. Stream links are signed and expire, so media is cached for at most 60 seconds and re-requested on every play and quality change.

**Playback** uses `streamUrl` only — never the raw CDN `url`, which answers 429 without the provider proxy. Streams are progressive MP4 (`hls` and `dash` are empty), played in a plain `<video>` element with play/pause, a timeline, ±10s, a quality menu, a subtitle menu and an episodes menu for series. If a stream times out, is refused or errors, VEYRA steps down to the next lower quality and then reports “Source busy. Try again.” (about 20 seconds per attempt, never an endless spinner).

**Subtitles** show only the languages the provider actually returns, converted from SubRip to WebVTT and fetched through the provider's `/api/proxy` route.

**Downloads** are best effort. VEYRA asks the provider's `downloadUrl` for its first byte and gives up after 20 seconds; if the provider's proxy-download route hangs (it is under maintenance), the attempt is recorded as unavailable. No progress bars are faked and no files are invented.

## Local storage

| Key | Contents |
| --- | --- |
| `veyra-list:v2` | My List — compact provider references |
| `veyra-history:v2` | Real playback records (`position`, `duration`, `percent`, `updatedAt`) |
| `veyra-settings:v2` | Subtitle language and appearance |
| `veyra-downloads:v1` | Download attempts and their provider results |

History is written only by actual playback (throttled `timeupdate`, pause, unmount, end). Continue Watching lists records between 2% and 95% complete with the season/episode label and minutes left. The history artwork opens the title; the X button removes the row.

## Verification status

`/api/homepage`, `/api/trending`, `/api/popular-searches`, `/api/hot-movies-series`, `/api/search`, `/api/search-suggestion`, `/api/item-details`, `/api/recommendations` and `/api/media` were all checked against the live API while this work was done (see [docs/MOVIEBOX_INTEGRATION.md](docs/MOVIEBOX_INTEGRATION.md) for the exact observations and the response shapes). `/api/media` returned three progressive MP4 qualities plus 15 caption languages for `Inception` (`subjectId 6391474290696802080`, `detailPath inception-e1BOR6f19C7`).

Browser CORS behaviour, Android runtime networking, signed-link lifetimes, long-session streaming stability and real-device playback are **not verified** from the build environment. Downloads on the provider side are currently unreliable by design of the service, not of this app.
