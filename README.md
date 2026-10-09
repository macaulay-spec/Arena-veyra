# VEYRA

VEYRA is a cinematic React/Vite streaming client packaged for Android with
Capacitor. It browses and plays a real catalogue served by the **ZST Labs**
provider through a VEYRA-controlled API layer: the client holds no credential
and knows nothing about the provider's shapes.

```
VEYRA client  →  VEYRA API layer (server/)  →  ZST Labs  →  VEYRA player
```

See [the verified API contract](docs/ZST_LABS_MOVIEBOX_API.md) for the route
inventory, response shapes, verification status and the media/security boundary.

## Run locally

```bash
npm ci
npm run api     # VEYRA API layer on :8787 (needs ZST_API_KEY in the environment)
npm run dev     # web client on :5173; the dev server mounts the same routes
```

With `VITE_VEYRA_API_BASE_URL` empty the client calls its own origin, so during
development the whole stack runs behind one port. Vite binds to `0.0.0.0`.

## Configuration

Public build configuration:

- `VITE_VEYRA_API_BASE_URL` — base URL of the VEYRA API layer, compiled into the
  web bundle and the Android assets. Leave empty for same origin. A Capacitor
  build always needs an absolute `https://` URL.

Server-only configuration (never in `VITE_*`, never in the repository):

- `ZST_API_KEY` — the provider credential, read by `server/` at call time.
- `ZST_API_BASE_URL` — defaults to `https://zstlab.cyou/api`.
- `ZST_MEDIA_PROXY_BASE_URL` — defaults to `https://api.zstlab.cyou`.
- `VEYRA_CORS_ORIGINS` — optional comma-separated extra allowed origins.
- `ZST_RATE_LIMIT_COOLDOWN_MS` — optional. Cooldown after the provider answers
  `429` (default: `Retry-After`, capped at 120 s, else 30 s; `0` disables it).

Deploy the API layer to any Node host and set the client's base URL to it. In
the Android workflow the public base comes from the `VEYRA_API_BASE_URL`
repository variable, so no secret is ever part of an APK.

## What the app does

- **Home** — the provider's own featured banner as a carousel plus every content
  rail it returned (Popular Series, Popular Movie, Nollywood, K-Drama, Coming
  Soon…). Promotional sections (`Get the VIP!`, channels, shorts) are filtered
  out, and rails with no titles are never rendered.
- **Discover / Search** — real trending and hot lists, debounced abortable
  search with provider suggestions, real popular searches, pagination, and
  honest loading, empty and error states.
- **Details** — real title metadata, cast from `data.stars`, real season and
  episode counts, and recommendations from the provider.
- **Player** — a real HTML5 player over the resolved stream: play/pause, seek,
  ±10s, mute, fullscreen, buffering, quality switching that re-resolves the
  stream, subtitle tracks from the title's real captions, episode switching,
  next episode, retry, and a fallback to the direct CDN URL if the proxy fails.
- **Downloads** — a real queue with `queued → downloading → paused / failed →
  completed → removing`, measured byte progress, and Range resume. The URL is
  always the one the API layer authorized.
- **Library** — My List, history, Continue Watching and playback progress
  persist on the device. Continue Watching only appears with real progress.
- **TV** — a dedicated large-screen layout with sidebar navigation and spatial
  D-pad movement (`src/tv.js`).
- **Offline** — connectivity is a state, not a different universe: the current
  screen stays and a subtle banner appears with a retry.

## Data flow

```
UI screens
   └─ src/services/catalog.js        catalog reads, short-lived cache
   └─ src/services/media.js          playback, subtitles, download metadata
   └─ src/services/downloads.js      the download queue
        └─ src/services/api/client.js      the only HTTP transport
             └─ src/services/api/normalize.js   model guards
                  └─ VEYRA API  /api/veyra/*
                       └─ server/providers/zst.js    holds ZST_API_KEY
                            └─ server/normalize.js   provider → VEYRA models
```

No component builds a media URL, reads a credential, or sees a provider field
name. Signed playback URLs are cached for at most 90 seconds and re-resolved on
demand; catalogue metadata is cached briefly on both sides.

## Local persistence

| Key | Contents |
| --- | --- |
| `veyra-list:v2` | Saved title references for My List |
| `veyra-history:v2` | Watch history, per-episode progress and completion state |
| `veyra-searches:v3` | Recent searches |
| `veyra-settings:v2` | Appearance and playback preferences |
| `veyra-downloads:v1` | Download records and their state |
| `veyra-welcome:v1` | Whether the welcome screen has been seen |

## Checks

```bash
npm test          # 79 unit tests: provider normalization, model guards, catalog
                  # mapping and caching, media resolution, download state machine,
                  # library persistence, copy mapping, TV navigation, rate-limit
                  # circuit breaker, playback fallback selection
npm run smoke:zst # live smoke tests against the real provider (needs ZST_API_KEY);
                  # 12 checks covering every confirmed endpoint + real source extraction
npm run build     # production web build (dist/)
```

## Android debug APK

Requirements: Node.js 22, JDK 21, Android SDK platform/build tools 35.

```bash
npm ci
VITE_VEYRA_API_BASE_URL=https://your-veyra-api.example npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

The APK is written to `android/app/build/outputs/apk/debug/app-debug.apk`. The
GitHub Actions `Android APK` workflow builds and uploads the debug artifact; it
fails loudly if the `VEYRA_API_BASE_URL` repository variable is not set, so a
credential-free APK can never be published pointing at nothing.

## Verification status

Verified in this workspace on 2026-10-08:

- `npm test` — 79 tests, 79 passing.
- `npm run build` — production build succeeds.
- `npm run smoke:zst` — 12 checks, 12 passing against the live provider:
  homepage (52 operations), trending, hot movies/series, popular searches,
  search suggestions, search, item details with cast, recommendations, media
  resolution for a movie and for a TV episode, proxy reachability, and real
  signed stream-source extraction.
- **Live provider integration** through the VEYRA API layer: health, homepage
  (18 featured titles, 30 content rails), trending, hot, popular searches,
  search, suggestions, details with cast, episodes, recommendations, media
  resolution with real qualities and captions, per-quality stream
  re-resolution, and download URL construction.
- **Rate-limit handling** — a provider `429` opens a circuit breaker: no
  in-process retry, follow-up calls fail fast without touching the network,
  `Retry-After` honoured, 429 never auto-retried client-side. Unit-tested in
  `server/zst-rate-limit.test.js` + `src/services/errors.test.js` and
  confirmed live (cooldown answers in ~1 ms instead of ~900 ms of retries).
- **Honest failure states (browser-verified)** — a title with no playable
  resource says “This title isn’t available to play.” instead of blaming the
  connection; playback fallbacks always cross subsystems (proxy → raw CDN), so
  a relay outage is recoverable; and the details screen renders the provider's
  cast records instead of crashing the screen (a shape mismatch previously
  blanked every title with a cast).

Not verified here, and not claimed:

- **Video bytes.** The provider's CDN answered `429` and its proxy answered a
  timeout for this datacenter IP. Playback must be confirmed on a real network.
- **Android APK / Gradle build** — no JDK or Android SDK in this sandbox. CI is
  the only verified path to an APK.
- **Native file persistence for downloads** — the queue and transfer are real
  and tested, but writing to device storage needs a Capacitor filesystem plugin
  on a real device.
- Real-device touch targets, hardware back button and low-end performance.
