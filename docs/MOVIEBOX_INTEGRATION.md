# VEYRA ↔ ZST Labs MovieBox integration

This document describes exactly what VEYRA calls, how responses are normalized, how playback is sourced, and what remains unverified. It replaces the earlier audit written against a different, metadata-only API deployment.

## Provider

| Item | Value |
| --- | --- |
| Base URL | `https://api.zstlab.cyou` |
| Key header | `x-api-key` on every JSON request |
| Public key form | `VITE_ZST_API_KEY` (see the warning below) |
| Base URL setting | `VITE_MOVIEBOX_API_BASE_URL` |
| Rate limit | roughly 300 requests / 5 minutes |
| Response envelope | `{ status, statusCode, creator, endpoint, data }` |

**The key is public.** VEYRA has no backend, so the key is compiled into the web bundle and the Android APK and is sent by the client. `.env.example` contains placeholders; `.env.local` (git-ignored) holds the working key; the Android workflow receives both values as build environment variables (`VITE_ZST_API_KEY` comes from a repository secret). There is no proxy server, and none is invented.

## Routes VEYRA calls (and nothing else)

| VEYRA feature | Service function | Route | Query | Transformation |
| --- | --- | --- | --- | --- |
| Home hero + rails + notice | `movieBoxClient.getHomepage()` | `GET /api/homepage` | — | Walks `data.operatingList` (`BANNER` items, `SUBJECTS`, and similar) plus any other content arrays; the first normalized record becomes the featured title. `extractNotice()` surfaces a real operator notice when the response carries one (`notice`, `maintenance`, `announcement`, `banner`), otherwise nothing is shown. Cached 10 minutes. |
| Trending rail | `getTrending()` | `GET /api/trending` | `page=0`, `perPage=18` | Normalizes `data.subjectList` and reads `data.pager` (`hasMore`, `nextPage`, `totalCount`). Cached 10 minutes. |
| Hot rail | `getHotMoviesAndSeries()` | `GET /api/hot-movies-series` | — | Normalizes `data.movie[]` and `data.tv[]`. Cached 10 minutes. |
| Search idle state | `getPopularSearches()` | `GET /api/popular-searches` | — | Reads `data.everyoneSearch[].title`. Cached 10 minutes. |
| Search + load more | `search()` | `GET /api/search` | `query`, `subjectType=ALL\|MOVIES\|TV_SERIES`, `page`, `perPage=24` | `query` is sent first; `q` is retried only when the normalized result set is empty. Load more is driven by `data.pager` (`hasMore` / `nextPage`), never by “24 items came back”. Cached 60 seconds. |
| Search suggestions | `getSearchSuggestions()` | `GET /api/search-suggestion` | `q` | **Singular route.** The plural `/api/search-suggestions` does not exist and is no longer called. Reads `data.items[].word`. Cached 60 seconds. |
| Details, seasons, cast | `getItemDetails()` | `GET /api/item-details` | `subjectId`, and `detailPath` whenever it exists | Reads `data.subject`, `data.stars` (staff type 2 → director, 1 → cast), and `data.resource.seasons` / `data.seasons`. Cached 5 minutes. |
| "More like this" | `getRecommendations()` | `GET /api/recommendations` | `subjectId` | Normalizes `data.items[]`; failures degrade to an inline error, not an empty fake rail. Cached 5 minutes. |
| Playback + quality + captions | `getMedia()` | `GET /api/media` | `subjectId`, `detailPath`, `season`, `episode` | Movies send `season=0&episode=0`; series send the real season/episode from details. `fresh: true` bypasses the cache on every play and quality change. Cached at most 60 seconds. |

Not called anywhere in the app: `/api/v1/moviebox/*` (metadata stubs with no streams), `/zstlabs/proxy/stream`, `/zstlabs/proxy/download` (404 on the live API), and raw `hakunaymatata.com` / `aoneroom` CDN URLs (those hosts answer 429 without the provider proxy).

## Media response and normalization

Live `/api/media` (checked against `subjectId 6391474290696802080`, `detailPath inception-e1BOR6f19C7`, `season=0&episode=0`):

```
data.downloads.data.downloads[] = { id, url, resolution, size, streamUrl, downloadUrl }
data.downloads.data.captions[]  = { id, lan, lanName, url, size, delay }
data.stream.data.streams[]      = { format: "MP4", url, resolutions, size, duration, codecName }
data.stream.data.{hls,dash}     = []      // progressive MP4 only
```

`normalizeMedia(payload)` returns:

```js
{
  hasResource,                                   // provider flag, and false when no usable quality remains
  qualities: [{ resolution, label, sizeBytes, streamUrl, downloadUrl }],  // sorted highest → lowest
  captions:  [{ lang, language, url }],          // only the languages actually returned
  duration,                                      // seconds, from the stream list
}
```

Rules the normalizer enforces:

- A quality is kept only when the player has a usable URL. When the provider returns a `streamUrl` it is used as-is (it is already `https://api.zstlab.cyou/api/proxy?url=…`). When the provider returns only a bare CDN `url`, VEYRA builds the same proxy route itself (`/api/proxy?url=<encoded>`). **A raw CDN URL never reaches the `<video>` element.**
- `downloadUrl` is only ever the provider's value; VEYRA does not construct download links.
- Caption links are rebuilt onto `/api/proxy` when they arrive through the maintenance-prone `proxy-download` route, so subtitles do not hang.
- `hasResource: false` (or zero usable qualities) is rendered as “no playable source right now”, never as a crash and never as an invented stream.

`extractSeasons()` reads `resource.seasons[]` / `seasons[]` entries of the form `{ se, maxEp, allEp, resolutions }`:

- `se` is preserved as `apiValue` and is what gets sent back to `/api/media`.
- Episodes are generated for `1..maxEp` **only when `allEp` is empty**. When `allEp` lists numbers, that list is used verbatim so gaps are preserved — VEYRA never re-numbers a season.
- Explicit episode arrays (title, description, thumbnail) are used when the provider returns them.

## Playback, progress and fallback

- Player `src` is always a proxied `streamUrl`. Media is re-requested on play, on quality change and on retry because the links are signed and expire.
- The UI reads state from the `<video>` element (`timeupdate`, `durationchange`, `play`, `pause`, `waiting`, `error`, `ended`) — there is no `setInterval` pretending to play anything.
- Resume: the saved position is applied on `loadedmetadata`; quality switches seek back to the current position when the duration allows it.
- Failure ladder: if a stream does not reach `readyState >= 2` within ~20 seconds, or the element errors, VEYRA records that URL, tries the next lower quality and finally reports **“Source busy. Try again.”** with a retry that refetches `/api/media`. A best-effort range probe reports how the provider responded (426/429/timeout) in the source note.
- Progress is persisted on throttled `timeupdate` (5 s / 10 s deltas), on pause, on unmount and on `ended`, into `veyra-history:v2`.

## Downloads

`downloadUrl` is requested and probed for its first byte with a 20-second timeout. Possible results:

| Result | Screen state | Copy |
| --- | --- | --- |
| Provider answers (200/206) | `ready` | “Ready — tap Save file”; the browser/app shell receives the provider link |
| No response within 20 s | `unavailable` | “The provider’s download service did not respond within 20 seconds… under maintenance” |
| HTTP error | `failed` | The status/reason the provider returned |
| No download link in `/api/media` | `unavailable` | The provider returned a stream but no download link |

No 0/25/50/100 progress is ever shown and no files are fabricated. VEYRA stores the attempt history in `veyra-downloads:v1` so the Downloads screen only ever lists real attempts.

## Caching and rate limiting

| Data | TTL |
| --- | --- |
| homepage / trending / hot / popular searches | 10 minutes |
| search results / search suggestions | 60 seconds |
| item-details / recommendations | 5 minutes |
| media | 60 seconds (bypassed on every play and quality change) |

The client also de-duplicates identical in-flight requests, keeps a rolling count of requests in the last five minutes and refuses to exceed the provider's ~300/5-minute budget (throwing a `RATE_LIMITED` error with a real message and retry instead of hammering the API).

## Errors surfaced to the user

`MovieBoxServiceError` maps transport and HTTP failures to codes that the UI turns into real copy with a retry:

| Code | Cause | UI message |
| --- | --- | --- |
| `API_NOT_CONFIGURED` | no base URL in the build | “The catalog API is not configured for this build…” |
| `UNAUTHORIZED` | HTTP 401/403 | “The catalog API rejected this build’s API key…” |
| `RATE_LIMITED` | HTTP 429 or local budget | “The catalog API is rate limited right now…” |
| `NOT_FOUND` | HTTP 404 | “The catalog API could not find that title.” |
| `TIMEOUT` / `NETWORK_ERROR` | no answer / no connection | “Could not reach the catalog API…” |
| `hasResource: false` | provider flag | “The provider has no playable source for this selection right now…” |
| stream timeout/refusal | element error, probe | Stepped-down qualities, then “Source busy. Try again.” |

## Verified against the live API

Checked on 2026-10-08 with the provider key:

- `/api/homepage` → `data.operatingList` with a `BANNER` group whose items carry `subjectId`, `subjectType`, `detailPath`, `image.url` and `subject.cover.url`; `topPickList` and `homeList` were empty at that moment, so rails must come from `operatingList` (they do).
- `/api/trending?page=0&perPage=2` → `data.subjectList[]` plus `data.pager { hasMore: true, nextPage: "1" }`.
- `/api/hot-movies-series` → `data.movie[]`, `data.tv[]`.
- `/api/popular-searches` → `data.everyoneSearch[].title`.
- `/api/search?query=inception` → `data.items[]` (Inception, `subjectId 6391474290696802080`, `detailPath inception-e1BOR6f19C7`) and `data.pager { hasMore: true, nextPage: "2", totalCount: 70 }`.
- `/api/search-suggestion?q=incep` → `data.items[].word` (`Inception`, `Inception: Jump Right Into the Action`). The singular route works; the plural one 404s.
- `/api/item-details?subjectId=6391474290696802080&detailPath=inception-e1BOR6f19C7` → `data.subject` (title, synopsis, `imdbRatingValue 8.8`, `hasResource: true`), `data.stars` (cast/director), `data.resource.seasons = [{ se: 0, maxEp: 0, allEp: "", resolutions: [360, 480, 1080] }]`.
- `/api/media?subjectId=6391474290696802080&detailPath=inception-e1BOR6f19C7&season=0&episode=0` → three downloads (`360`, `480`, `1080`) each with `streamUrl` on `/api/proxy`, `downloadUrl` on `/api/proxy-download`, plus 15 caption languages; `stream.data.streams` reported `duration: 8888`, `dash: []`, `hls: []`.
- `/api/recommendations?subjectId=6391474290696802080` → `data.items[]`.
- `/api/proxy?url=…srt…` returned real SubRip text for a caption link (so the subtitle path works), and a series episode (`Black Clover`, `season=1&episode=1`) returned four MP4 qualities.

**Not verified:** browser CORS behaviour from the app origin, Android runtime networking, real-device playback/DASH-free streaming stability, how long signed links stay valid, and whether the provider's full-film CDN responds quickly (early reports say it can hang — the fallback ladder exists for that). The provider's proxy-download route is under maintenance, so downloads are best effort by definition.

## Environment summary

```bash
npm ci
cp .env.example .env.local     # VITE_MOVIEBOX_API_BASE_URL + VITE_ZST_API_KEY (placeholders in the repo)
npm test                       # normalizer, media, subtitle, client unit tests
npm run test:ssr               # renders every screen with real catalog shapes
npm run build                  # web bundle (env is inlined here)
npx cap sync android           # copies the bundle + env into the APK assets
cd android && ./gradlew assembleDebug
```

Anything prefixed `VITE_` is public. Do not put credentials, tokens or private infrastructure in `VITE_*` values: they ship in the bundle and the APK.
