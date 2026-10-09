# VEYRA ⇄ ZST Labs MovieBox API — verified contract

Every claim in this document was confirmed against the live provider from this
workspace on **2026-10-08** unless it is explicitly labelled `SUPPORTED` or
`UNKNOWN`. Nothing is inferred from endpoint names, and no credential appears
in it. Secrets are placeholders only (`<ZST_API_KEY>`).

---

## 1. Configuration

| Variable | Scope | Value used in this verification |
| --- | --- | --- |
| `ZST_API_BASE_URL` | server only | `https://zstlab.cyou/api` (aliased 1:1 by `https://api.zstlab.cyou/api`) |
| `ZST_API_KEY` | server only | `<ZST_API_KEY>` — **never** in `VITE_*`, never in the repository, never logged |
| `ZST_MEDIA_PROXY_BASE_URL` | server only | `https://api.zstlab.cyou` (host that serves `/api/proxy` and `/api/proxy-download`) |
| `ZST_SMOKE_BASE_URL` | test only | optional smoke-test override (defaults to `ZST_API_BASE_URL`) |

The key is read at call time from `process.env.ZST_API_KEY` in
`server/providers/zst.js`, the only module that knows the provider host, header
and envelope. The key is never returned to a caller, never written to a log, and
never part of any URL sent to the client.

## 2. Authentication — VERIFIED

All catalogue routes accept the key via the `x-api-key` request header
(`?apikey=` also works on some routes, but the header avoids keys in URLs that
might end up in logs or share sheets).

```
GET https://zstlab.cyou/api/homepage
  (no header) → 401 {"error":"Unauthorized","message":"API key required. Pass x-api-key header or ?apikey= query param."}
  x-api-key: <ZST_API_KEY> → 200 {"status":true,"statusCode":200,"creator":"Godszeal (ZST LABS)","endpoint":"/api/homepage","data":{…}}
```

Success envelope (all catalogue routes):

```jsonc
{
  "status": true,             // false on provider-side errors
  "statusCode": 200,
  "creator": "Godszeal (ZST LABS)",
  "endpoint": "/api/homepage",
  "data": { … }
}
```

Failure envelope:

```jsonc
{
  "status": false,
  "statusCode": 500,
  "creator": "Godszeal (ZST LABS)",
  "endpoint": "/api/item-details",
  "error": "HTTP 404 from https://moviebox.id/wefeed-h5-bff/web/subject/detail?subjectId=70523"
}
```

VEYRA raises a structured `ProviderError` from any of these and never surfaces
the upstream text to a viewer.

## 3. Route inventory

| Route | State | Notes |
| --- | --- | --- |
| `/api/homepage` | VERIFIED 200 | ~730 KB. `data.operatingList[]` positions + `BANNER` |
| `/api/trending?page&perPage` | VERIFIED 200 | `data.subjectList[]` + `data.pager`; honours `perPage` exactly |
| `/api/hot-movies-series` | VERIFIED 200 | `data.movie[]` and `data.tv[]` |
| `/api/popular-searches` | VERIFIED 200 | `data.everyoneSearch[].title` |
| `/api/search?query&subjectType&page&perPage` | VERIFIED 200 | `data.items[]` + `data.pager`; echoes `query`, `subjectType`, `page`, `perPage`, `source` |
| `/api/search-suggestion?query&per_page` | VERIFIED 200 | **singular** route; **snake_case `per_page`** is the parameter the provider honours |
| `/api/search-suggestions` | VERIFIED 404 | the plural spelling does not exist on this host |
| `/api/item-details?subjectId&detailPath` | VERIFIED 200 | `data.subject`, `data.stars[]`, `data.resource.seasons[]` |
| `/api/recommendations?subjectId&page&perPage` | VERIFIED 200 | `data.items[]` |
| `/api/media?subjectId&detailPath&season&episode` | VERIFIED 200 | `data.stream`, `data.downloads`, `data.subtitles` |
| `/api/stream` | VERIFIED 200 | quality-specific re-resolution; falls back to `/api/media` in VEYRA when the split is missing |
| `/api/subtitles` | VERIFIED 404 | captions only exist inside `/api/media` |
| `/api/download` | VERIFIED 404 | downloads are `/api/proxy-download?url=…` |
| `/api/health` | VERIFIED 404 | no health route exists on either host |
| `/api/proxy?url=` | VERIFIED 400 | media host; does not require the key when the `url` parameter is absent |
| `/api/proxy-download?url=&name=&quality=` | VERIFIED 200/400 | media host; hangs/times out for this datacenter IP (see §12) |

## 4. Subject shape (catalogue) — VERIFIED

```jsonc
{
  "subjectId": "8977867836450298272",
  "subjectType": 2,                     // 1 = movie, 2 = series
  "title": "Hello, Me!",
  "description": "",
  "releaseDate": "2021-02-17",
  "duration": 0,                        // seconds; 0 for series
  "genre": "Comedy,Drama,Fantasy",      // comma-separated string
  "cover": { "url": "…", "width": 432, "height": 636, "blurHash": "…", "avgHueDark": "#66554a" },
  "countryName": "Korea",
  "imdbRatingValue": "7.3",
  "imdbRatingCount": 849,
  "subtitles": "English,Arabic",        // comma-separated languages
  "hasResource": true,
  "detailPath": "hello-me-kclsXSfJcHa",
  "stills": { "url": "…" },
  "postTitle": "Self esteem boost!"
}
```

VEYRA normalization: `subjectId + detailPath` become the canonical
`zst:<subjectId>` id; `subjectType` becomes `movie`/`series`; `genre` becomes a
real `genres[]` array; `cover.url` becomes `poster`; `stills.url` (falling back
to `cover.url`) becomes `backdrop`; `duration` (seconds) becomes
`runtimeMinutes`; `imdbRatingValue`/`imdbRatingCount` become `rating` /
`ratingCount`. A record without both a title and a stable identifier is
**dropped**, never fabricated.

## 5. GET /api/homepage — VERIFIED

```
GET https://zstlab.cyou/api/homepage
x-api-key: <ZST_API_KEY>
```

~730 KB payload. `data.operatingList[]` is an ordered list of positioned
operations (`position` field), each with one of these `type` values, verified
from the live response:

| `type` | Content carried | VEYRA treatment |
| --- | --- | --- |
| `BANNER` | `op.banner.items[]` — hero subjects with wide `image` art | Featured hero carousel |
| `SUBJECTS_MOVIE` | `op.subjects[]` — a real content rail | Rails (Popular Series, Nollywood Movie, K-Drama, …) |
| `PLAY_LIST` | `op.subjects[]` — a shorter curated list (3 items on the live response) | Rails (Popular Movies, Western TV Shows, …) |
| `APPOINTMENT_LIST` | `op.subjects[]` — Coming Soon | Rails (Coming Soon) |
| `CUSTOM`, `SPORT_LIVE`, `FILTER` | promotional/machinery blocks, no subjects | **Filtered out** |

Rail labels that are promotional or catalogue machinery (`Get the VIP!`,
`Hot TV Channels`, `Fight Zone Shorts`, `Netflix WWE Live & Replay`, `Trending
Songs in Africa`, `Movies in Minutes`, …) are filtered out by
`normalizeHomepage` so the viewer only sees real content rows.

The provider does **not** publish a "Latest" or "Recently Added" rail. VEYRA
never invents one; it renders exactly the rails the provider returns.

## 6. GET /api/trending — VERIFIED

```
GET https://zstlab.cyou/api/trending?page=0&perPage=20
x-api-key: <ZST_API_KEY>
```

- `data.subjectList[]` — the page of subjects.
- `data.pager` — `{ hasMore, nextPage, page, perPage, totalCount }`. `page` and
  `perPage` are echoed as **strings** and are 0-based (`page=0&perPage=20` →
  first 20 titles, `nextPage: "1"`); `totalCount` was `0` on the live response,
  so VEYRA uses `hasMore`, not the count, to decide whether to keep loading.

`perPage` is honoured exactly (verified with `perPage=5` → 5 items).

## 7. GET /api/hot-movies-series — VERIFIED

```
GET https://zstlab.cyou/api/hot-movies-series
x-api-key: <ZST_API_KEY>
```

Returns two sibling lists that must stay separate:

- `data.movie[]` — 7 entries on the live response.
- `data.tv[]` — 6 entries on the live response.

VEYRA maps these to two separate rails (`Popular Movies`, `Popular Series`) and
never merges the two lists, because the shapes can diverge.

## 8. GET /api/popular-searches — VERIFIED

```
GET https://zstlab.cyou/api/popular-searches
x-api-key: <ZST_API_KEY>
```

`data.everyoneSearch[]` — a list of `{ title }` records. On the live response:
7 terms, e.g. `"Coven Academy"`, `"Neagley"`, `"MY 30TH WEDDING"`,
`"Prison Break"`. VEYRA uses these as search-chip suggestions only.

## 9. GET /api/search-suggestion — VERIFIED

```
GET https://zstlab.cyou/api/search-suggestion?query=inception&per_page=10
x-api-key: <ZST_API_KEY>
```

- **Singular** route. `/api/search-suggestions` is a verified 404.
- **`per_page`** (snake_case) is the parameter the provider honours — verified:
  `perPage=3` returns 10 items while `per_page=3` returns 3.
- `data.items[]` — `{ type, word, subject }`. On the live response `type` is
  always `0` and `subject` is always `null`, so the type cannot be trusted as a
  movie/series discriminator; VEYRA maps every suggestion to `kind: "title"`.

Verified probes:

| Query | Live `items[].word` |
| --- | --- |
| `inception` | `Inception`, `Inception: Jump Right Into the Action` |
| `avengers` | `avengers: doomsday`, `avengers: endgame encore`, `Avengers: Infinity War`, `Avengers: Secret Wars`, … |
| `one piece` | `One Piece`, `one piece english`, `one piece season 2`, `One Piece: Stampede`, … |
| `dark` | 10 items (with `per_page=10`) |

## 10. GET /api/search — VERIFIED

```
GET https://zstlab.cyou/api/search?query=inception&subjectType=ALL&page=0&perPage=10
x-api-key: <ZST_API_KEY>
```

Parameters, all verified:

- `query` — free text.
- `subjectType` — `ALL` \| `1` \| `2`. `1` = movies only, `2` = series only.
  VEYRA sends `ALL`/`MOVIES`/`TV_SERIES` from the UI and maps them to
  `ALL`/`1`/`2` before the request.
- `page` — 1-based on this route (echoed back as `page: "1"` for the first
  page even when `page=0` is sent; verified with `page=2` → `pager.page: "2"`).
- `perPage` — honoured exactly; `10` on the live probe.

`data` carries `pager`, `items[]` and `counts[]`:

```jsonc
"pager": { "hasMore": true, "nextPage": "2", "page": "1", "perPage": 10, "totalCount": 69 },
"counts": [
  { "subjectType": 0, "name": "All",    "num": 0 },
  { "subjectType": 2, "name": "Series", "num": 0 },
  { "subjectType": 1, "name": "Movies", "num": 0 },
  { "subjectType": 6, "name": "Music",  "num": 0 }
]
```

The `counts[].num` fields were `0` on every live probe, so VEYRA does not use
them. `totalCount` in `pager` **is** populated for search (`69`, `4492`, …) and
is used for pagination display.

Verified probes: `query=dark&subjectType=2` returns `Dark Shadows`, `Dark`,
`Dark Matter`, `Dark Matter`, `Dark Winds`; `query=dark&subjectType=1` returns
`Dark Nuns`, `The Dark Knight`, `Dark Phoenix`, `The Dark Knight Rises`,
`Terminator: Dark Fate`.

VEYRA renders **exactly** what the provider returns and an honest empty state
when the list is empty — no fabricated filler results.

## 11. GET /api/item-details — VERIFIED

```
GET https://zstlab.cyou/api/item-details?subjectId=6391474290696802080&detailPath=inception-e1BOR6f19C7
x-api-key: <ZST_API_KEY>
```

`data` shape, verified on both a movie and a series:

```jsonc
{
  "subject": { …same shape as §4… },
  "stars": [ { "staffId": "7674926235897973928", "staffType": 2, "name": "Christopher Nolan",
               "character": "Director", "avatarUrl": "…", "detailPath": "…" } ],
  "resource": {
    "seasons": [
      { "se": 1, "maxEp": 10, "allEp": "",
        "resolutions": [ { "resolution": 360, "epNum": 1 }, { "resolution": 480, "epNum": 10 },
                         { "resolution": 720, "epNum": 10 }, { "resolution": 1080, "epNum": 6 } ] }
    ],
    "source": "fzmovies.cms",
    "uploadBy": "Preciosa Osa"
  },
  "metadata": …,
  "isForbid": false,
  "watchTimeLimit": …,
  "seasons": …,
  "seasonCount": …,
  "seasonSource": …,
  "isSeries": true
}
```

Verified behaviour:

- **Season numbering is 1-based** (`se: 1` = Season 1). `se: 0` with `maxEp: 0`
  appears for a **movie** and must be ignored — VEYRA drops such records
  (`normalizeSeasons` filters `!episodeCount`).
- The provider publishes per-season episode **counts** (`maxEp`), not a list of
  episode records, so VEYRA derives `Episode 1…N` from the real count rather
  than hardcoding a number.
- Per-season `resolutions[].epNum` tells which episode a resolution is available
  up to — kept in the normalized `episodeResolutions` field so the player can
  hide qualities that do not exist for a particular episode.
- No per-episode titles exist in the response; VEYRA labels episodes from the
  real count, never from a fabricated title.

**Known provider data issue (VERIFIED, external):** a handful of series on this
deployment answer `item-details` with `HTTP 404 from
https://moviebox.id/wefeed-h5-bff/web/subject/detail?subjectId=70523` even for
the subject id the provider itself just returned from search. Confirmed on
`Dark` (70523), `Dark Shadows` (2883), `Breaking Bad`, `Prison Break`, `Money
Heist`, `The Boys`. Well-behaved titles (e.g. `Coven Academy`,
`Inception`) resolve normally on both hosts. This is an upstream catalog
mapping bug, not a route failure; VEYRA surfaces it as a clean 404, never a
fabricated detail page.

## 12. GET /api/media — VERIFIED (the most important route)

```
GET https://zstlab.cyou/api/media?subjectId=6391474290696802080&detailPath=inception-e1BOR6f19C7
GET https://zstlab.cyou/api/media?subjectId=5409343034641236440&detailPath=dark-SL2tmABQAr6&season=1&episode=1
x-api-key: <ZST_API_KEY>
```

For a **series**, `season` and `episode` are required and are **1-based**
(`season=1&episode=1` = S1E1). Omitting them for a series returns
`hasResource:false` with empty `streams`. For a **movie**, omit both.

`data` carries three sibling blocks, each with its own `{ code, message, data }`:

```jsonc
{
  "data": {
    "stream":    { "code": 0, "data": { "streams": […], "hls": [], "dash": [], "hasResource": true, "limited": false, "freeNum": 6 } },
    "downloads": { "code": 0, "data": { "downloads": […], "captions": […], "hasResource": true } },
    "subtitles": { "code": 0, "data": { "downloads": […], "captions": […], "hasResource": true } }
  }
}
```

### `stream.data.streams[]` — VERIFIED

```jsonc
{
  "id": "…",
  "url": "https://bcdnxw.hakunaymatata.com/tran-audio/20250609/<hash>.mp4?sign=<signature>&t=<unix-expiry>",
  "resolutions": "1080",      // string
  "size": "2414667149",       // string, bytes
  "duration": 8888,           // number, seconds
  "codecName": "h264",
  "format": "MP4"
}
```

- **`url` is signed and expires.** Verified parameters `sign=<hash>` (opaque
  signature) and `t=<unix-seconds>` (expiry stamp, e.g. `t=1791360623`). VEYRA
  turns `t` into `expiresAt` and re-resolves when stale rather than playing a
  dead link.
- `hls` and `dash` arrays exist and were **empty** on every title probed on
  2026-10-08. VEYRA handles them when populated but does not assume it.
- `resolutions` is a **string** here; `downloads[].resolution` is a **number**.
  Both are coerced through the same integer coercion.

### `downloads.data.downloads[]` — VERIFIED

```jsonc
{
  "id": "…",
  "url": "https://bcdnxw.hakunaymatata.com/bt/<hash>",           // direct CDN
  "streamUrl":  "https://api.zstlab.cyou/api/proxy?url=https%3A%2F%2Fbcdnxw…",
  "downloadUrl":"https://api.zstlab.cyou/api/proxy-download?url=https%3A%2F%2Fbcdnxw…",
  "resolution": 360,
  "size": "777303372"
}
```

The provider **already supplies proxied variants** beside the direct CDN URLs.
VEYRA plays the proxied `streamUrl` (it carries the correct referer and CORS
headers for a WebView) and keeps the direct URL only as a retry fallback —
never the other way round. This also prevents double-proxying: the normalizer
never wraps a `streamUrl`/`downloadUrl` that is already a `api.zstlab.cyou/api/proxy…` URL.

### `downloads.data.captions[]` / `subtitles.data.captions[]` — VERIFIED

```jsonc
// downloads block: direct SRT URLs
{ "id": "…", "lan": "en", "lanName": "English", "url": "https://cacdn.hakunaymatata.com/subtitle/<hash>",
  "size": "3765", "delay": 0 }

// subtitles block: the SAME captions, but url is already proxied
{ "id": "…", "lan": "en", "lanName": "English", "url": "https://api.zstlab.cyou/api/proxy-download?url=https%3A%2F%2Fcacdn…" }
```

Verified behaviour:

- Both forms were fetched from this workspace and returned **real SRT bytes**
  (`1\n00:00:55,680 --> 00:00:57,473\n[CHILDREN LAUGHING]…`) with
  `Content-Type: application/octet-stream` and a real `Content-Length`.
- `lan` is an ISO-ish code (`ar`, `bn`, `en`, `fil`, `fr`, `ha`, `hi`, `in_id`,
  `ms`, `pa`, `pt`, `ru`, `sw`, `ur`, `zh`) and `lanName` is the human label.
- VEYRA prefers the **already-proxied** caption URL (the `subtitles` block) so
  the WebView never has to reach the CDN directly.
- Captions are **never fabricated**: only languages actually present in the
  response are rendered in the player's subtitle menu.

### Verified live media sizes on 2026-10-08

| Title | Kind | Resolutions returned |
| --- | --- | --- |
| Inception (6391474290696802080) | movie | 1080p, 480p, 360p |
| Dark S1E1 (5409343034641236440) | series | 480p, 720p, 1080p |
| Onslaught (2934065197151043920) | movie | 360p, 480p, 1080p |
| Neagley (82258967610676552) | series S1E1 | 360p, 480p, 1080p |
| Below (2848137736375136784) | series S1E1 | 480p, 720p, 1080p |
| Coven Academy | series S1E1 | 1080p, 480p, 360p |

Nothing is invented: a title's quality list is whatever the provider returned
for that exact subject.

## 13. GET /api/proxy and GET /api/proxy-download — VERIFIED

```
GET https://api.zstlab.cyou/api/proxy?url=<urlencoded target>
GET https://api.zstlab.cyou/api/proxy-download?url=<urlencoded target>&name=<filename>&quality=<height>
```

- Neither requires the API key (verified: the bare call with no `url` answers
  `400` rather than `401`).
- `proxy-download` accepts optional `name` (filename) and `quality` (height)
  parameters. Verified with `&name=demo&quality=480` — the call itself is well
  formed but the relay still timed out for this datacenter IP (see below).
- **Do not double-proxy**: the response's `streamUrl`/`downloadUrl` already come
  pre-proxied. VEYRA's normalizer detects an existing `api.zstlab.cyou/api/proxy…`
  prefix and passes it through unchanged rather than wrapping it again.
- **Fallback rule (VERIFIED against the live payload)**: a source's
  `fallbackUrl` always sits on the *other* subsystem from its primary `url`.
  Streams-derived sources fall back to the raw signed CDN URL; downloads-derived
  sources keep the record's raw `url` as their fallback. Falling back from
  `/api/proxy` to `/api/proxy-download` recovers nothing, because both live
  behind the same relay and fail together — a viewer whose network can reach
  the CDN directly must still get a playable URL when the relay is down.

### Range support — VERIFIED on the relay, UNREACHABLE on the CDN from this IP

```
curl -H "Range: bytes=0-2047" "<proxy-url>"
  → HTTP/2 … accept-ranges: bytes          (header present on the relay)
  → but this datacenter IP received 500 "The operation was aborted due to timeout" after 31 s
```

The provider CDN itself (`bcdnxw.hakunaymatata.com`) answered `429` for every
direct range probe from this datacenter IP (an nginx HTML rate-limit page), and
`api.zstlab.cyou/api/proxy-download` hung until timeout. This is a
**datacenter-IP restriction on the provider side**, not a VEYRA defect: the
catalogue, metadata, media resolution and caption bytes all work from here, and
byte-level playback must be confirmed from a normal residential network or a
real device.

VEYRA's player therefore treats **actual player events** (`loadedmetadata`,
`playing`, `timeupdate`, `error`) as the authority for playback, not the HTTP
status of a Range probe, and falls back to the direct CDN URL if the proxy
fails mid-playback.

## 14. GET /api/stream — VERIFIED (quality re-resolution)

```
GET https://zstlab.cyou/api/stream?subjectId=…&detailPath=…&quality=480&season=1&episode=1
x-api-key: <ZST_API_KEY>
```

- Wraps the same `stream` block directly under `data` (no `stream.data` nesting).
- The catalogue host answers this route; the media host rejects some calls, so
  VEYRA's `getStream` tries the catalogue base first and falls back to the media
  base on failure.
- The route does not always split by resolution; when it returns no usable
  source for the requested height, VEYRA falls back to a full `/api/media`
  request and selects the closest real quality from the real source list.
  A quality label in the UI is **never** changed without a real re-resolution
  behind it.

## 15. Caching policy — VERIFIED design

| Data | Cache | Reason |
| --- | --- | --- |
| Homepage | 120 s server, 90 s client | Large and stable |
| Trending / hot | 60 s | Changes often |
| Popular searches | 300 s | Rarely changes |
| Search | never | Must be fresh |
| Suggestions | never | Must be fresh |
| Details / episodes / recommendations | 300 s | Stable metadata |
| **Media / stream / download URLs** | **never** | Signed and expiring (`t=` unix stamp); memoizing them would hand out dead links |

`server/veyra-api.js` marks every media-family route `Cache-Control: no-store`.
`expiresAt` from the `t=` parameter is surfaced to the player so a stale stream
can be detected and re-resolved **once**, instead of endlessly retrying.

## 16. Error handling — VERIFIED design

`server/providers/zst.js` raises a `ProviderError` with one of these stable
codes, which the API layer maps to a clean client-facing code with no upstream
detail:

| Provider condition | `ProviderError.code` | Client code | Retryable |
| --- | --- | --- | --- |
| Missing `ZST_API_KEY` | `PROVIDER_NOT_CONFIGURED` | `NOT_CONFIGURED` (503) | no |
| 401 / 403 | `PROVIDER_UNAUTHORIZED` | `CATALOG_UNAVAILABLE` (502) | no |
| 404 | `PROVIDER_REJECTED` | `CATALOG_UNAVAILABLE` / `NOT_FOUND` (404) | no |
| 429 | `PROVIDER_RATE_LIMITED` | `RATE_LIMITED` (429) | no — opens the cooldown (§16a) |
| 5xx | `PROVIDER_UNAVAILABLE` | `CATALOG_UNAVAILABLE` (502) | yes |
| Timeout | `PROVIDER_TIMEOUT` | `UPSTREAM_TIMEOUT` (504) | yes |
| Malformed JSON | `PROVIDER_INVALID_RESPONSE` | `CATALOG_UNAVAILABLE` (502) | no |
| Caller abort | `PROVIDER_ABORTED` | `ABORTED` (499) | no |

Requests carry a 12 s timeout (20 s for media, 25 s for the ~730 KB homepage),
one automatic retry with linear backoff for safe transient failures, and full
`AbortSignal` propagation so one component cancelling its request never cancels
another component's shared request. Media resolution is independently
cancellable per play call. URLs are redacted (`sign=`, `t=`, `Policy=`,
`Signature=`, `apikey=`) before any log line is written.

### 16a. Rate-limit circuit breaker — VERIFIED design

A 429 is **never retried in-process**. When one arrives, the adapter opens a
process-wide cooldown during which every provider call fails fast with
`PROVIDER_RATE_LIMITED` and no network request is made. Without this, the
provider's own retry, the API routes, and the web client's media retries
multiplied one rate limit into ~6 upstream hits per user action — which is
exactly what kept the provider's window open.

- Cooldown duration: `Retry-After` header if present (capped at 120 s),
  otherwise 30 s.
- `ZST_RATE_LIMIT_COOLDOWN_MS` overrides it (set `0` to disable the cooldown).
- The web client treats HTTP 429 as **non-retryable** too: `RATE_LIMITED`
surfaces immediately for a manual, backed-off retry instead of hammering.
- Errors are never memoised by the catalogue cache, so the cooldown expiring
  is the only gate back to the provider.
- Unit-tested in `server/zst-rate-limit.test.js` (no in-process retry, fast-fail
during cooldown, `Retry-After` honoured, `0` opt-out) and
`src/services/errors.test.js` (429 not auto-retried client-side).

## 17. Verification status summary

| Capability | Status |
| --- | --- |
| Configuration centralization (`server/providers/zst.js`) | VERIFIED |
| Key never in source, logs, or client bundle | VERIFIED |
| Homepage → rails / hero | VERIFIED against live provider |
| Trending (paged) | VERIFIED |
| Hot movies / series | VERIFIED |
| Popular searches | VERIFIED |
| Search suggestions | VERIFIED (incl. `per_page` parameter) |
| Search (paged, per subjectType) | VERIFIED |
| Movie details | VERIFIED |
| TV details / seasons / episodes | VERIFIED (per-title upstream gaps documented in §11) |
| Recommendations | VERIFIED |
| Media resolution (multiple qualities) | VERIFIED |
| Subtitles / captions (real SRT bytes) | VERIFIED |
| Proxy behaviour / no double-proxying | VERIFIED |
| Download URL construction (separate from playback) | VERIFIED |
| Real stream URL extraction | VERIFIED (`sign=`+`t=` signed CDN links) |
| **Actual video playback (currentTime advancing)** | **UNKNOWN from this datacenter IP** — CDN answers 429 and the proxy times out for this network. The player path itself is wired and unit-tested; byte-level playback must be confirmed from a residential network or real device. |
| Stale stream refresh | SUPPORTED (code path + `expiresAt` in place; end-to-end expiry not observed in-session) |
| Automated smoke tests | VERIFIED — `node scripts/zst-smoke-test.mjs` → 12/12 PASS |

## 18. Reproducing this verification

```bash
# Catalog + media smoke tests against the live provider (needs ZST_API_KEY).
node scripts/zst-smoke-test.mjs

# Optional: probe a different deployment mirror.
ZST_SMOKE_BASE_URL=https://movieboxapi.vercel.app/api node scripts/zst-smoke-test.mjs

# Unit tests (70) and production build.
npm test
npm run build
```

The smoke script never prints the API key and never prints a resolved stream
URL; it only reports counts, heights, HTTP statuses and PASS/FAIL per endpoint.

## 19. Live deployment notes (2026-10-08)

- Both `https://zstlab.cyou/api` and `https://api.zstlab.cyou/api` answered
  identically during verification (same 729 KB homepage payload byte-for-byte).
- The provider's own upstream is `moviebox.id`; the `error` field on a failed
  `item-details` call sometimes names it directly — this is provider-side text
  that VEYRA strips before responding to a client.
- A secondary mirror (`https://movieboxapi.vercel.app/api`) exists with the same
  route surface and a slightly different envelope (`status:"success"`, creator
  `"God's Zeal"`, `creatorUrl` field). Its `/media` route additionally
  pre-proxies some stream URLs through `proxy.cinemind.name.ng`, which itself
  answered `530` from this IP. It is not used by VEYRA; documented for
  completeness.
- A handful of series carry broken upstream mappings (§11). This is an
  upstream data bug and is surfaced as a clean 404 to the viewer.
