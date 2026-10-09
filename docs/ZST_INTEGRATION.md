# VEYRA ⇄ ZST Labs integration

Everything in this document was observed by calling the deployed provider from
this workspace. Nothing is inferred from endpoint names, and no credential
appears in it.

## Architecture

```
VEYRA Android / web client
      │   (no credential, no provider knowledge)
      ▼
VEYRA API layer            server/            ← holds ZST_API_KEY
      │
      ▼
ZST Labs                   https://zstlab.cyou/api
      │                    https://api.zstlab.cyou
      ▼
VEYRA player
```

- The client talks only to `/api/veyra/*`. `src/services/api/client.js` is the
  single module that performs HTTP for catalogue and playback data.
- `server/providers/zst.js` is the only module that knows the provider's hosts,
  its `x-api-key` header and its envelope. Replacing the provider means
  replacing that one file.
- `server/normalize.js` converts provider shapes into VEYRA models, so no
  provider field name reaches a component.
- The provider credential is read from `process.env.ZST_API_KEY` at call time.
  It is never returned, logged, or sent to a client.

## Authentication

Both hosts require the key on catalogue routes:

```
GET https://zstlab.cyou/api/homepage
    → 401 {"error":"Unauthorized","message":"API key required. Pass x-api-key header or ?apikey= query param."}

GET https://zstlab.cyou/api/homepage      (with x-api-key)
    → 200 {"status":true,"statusCode":200,"creator":"Godszeal (ZST LABS)","endpoint":"/api/homepage","data":{…}}
```

The `apikey` query parameter works too, but VEYRA uses the header so the key
never ends up in a URL that could be logged or shared.

## Route inventory (verified against the live deployment)

| Route | State | Notes |
| --- | --- | --- |
| `/api/homepage` | 200 | ~730 KB. `data.operatingList[]` positions + `BANNER` |
| `/api/trending?page&perPage` | 200 | `data.subjectList[]` + `data.pager` |
| `/api/hot-movies-series` | 200 | `data.movie[]` and `data.tv[]` |
| `/api/popular-searches` | 200 | `data.everyoneSearch[].title` |
| `/api/search?query&subjectType&page&perPage` | 200 | `data.items[]` + `data.pager`, echoes `query`, `subjectType`, `page`, `perPage`, `source` |
| `/api/search-suggestion?query&perPage` | 200 | **singular**; `data.items[].word` |
| `/api/search-suggestions` | **404** | the plural spelling does not exist on this host |
| `/api/item-details?subjectId&detailPath` | 200 | `data.subject`, `data.stars[]`, `data.resource.seasons[]` |
| `/api/recommendations?subjectId&page&perPage` | 200 | `data.items[]` |
| `/api/media?subjectId&detailPath&season&episode` | 200 | `data.stream`, `data.downloads`, `data.subtitles` |
| `/api/stream?subjectId&detailPath&quality&season&episode` | 200 | `data.streams[]`; the catalogue host answers, the media host rejects some calls |
| `/api/subtitles` | **404** | captions only exist inside `/api/media` |
| `/api/download` | **404** | downloads are `/api/proxy-download?url=…` |
| `/api/health` | **404** | no health route exists on either host |
| `/api/proxy?url=` | 400 without `url` | media host; does not require the key |
| `/api/proxy-download?url=` | 400 without `url` | media host; does not require the key |

Because there is no health route, `GET /api/veyra/health` probes a real
catalogue read and a real media-host request, and reports `catalog`/`media`
as `up` or `down` separately.

### Subject shape (catalogue)

```jsonc
{
  "subjectId": "8977867836450298272",
  "subjectType": 2,                     // 1 = movie, 2 = series
  "title": "Hello, Me!",
  "description": "",
  "releaseDate": "2021-02-17",
  "duration": 0,                        // seconds; 0 for series
  "genre": "Comedy,Drama,Fantasy",      // comma-separated string
  "cover": { "url": "...", "width": 432, "height": 636, "blurHash": "...", "avgHueDark": "#66554a" },
  "countryName": "Korea",
  "imdbRatingValue": "7.3",
  "imdbRatingCount": 849,
  "subtitles": "English,Arabic",        // comma-separated languages
  "hasResource": true,
  "detailPath": "hello-me-kclsXSfJcHa",
  "stills": { "url": "..." },
  "postTitle": "Self esteem boost!"
}
```

### Playback package (`/api/media`)

```jsonc
{
  "data": {
    "stream": {
      "data": {
        "streams": [{ "id": "…", "url": "https://cdn…/1080.mp4?sign=…&t=1791360623",
                      "resolutions": "1080", "size": "2414667149", "duration": 8888, "codecName": "h264", "format": "MP4" }],
        "hls": [], "dash": [], "hasResource": true, "limited": false, "freeNum": 6
      }
    },
    "downloads": {
      "data": {
        "downloads": [{ "id": "…", "url": "https://cdn…", "resolution": 1080, "size": "2414667149",
                        "streamUrl": "https://api.zstlab.cyou/api/proxy?url=…",
                        "downloadUrl": "https://api.zstlab.cyou/api/proxy-download?url=…" }],
        "captions": [{ "id": "…", "lan": "ar", "lanName": "اَلْعَرَبِيَّةُ", "url": "https://cdn…/x.srt?Policy=…", "size": "79396", "delay": 0 }]
      }
    },
    "subtitles": { "data": { "captions": [{ "…same fields, but url is already proxied…" }] } }
  }
}
```

Verified behaviour:

- **Season/episode are 1-based.** `/api/media?subjectId=X` (no season/episode)
  returns `hasResource:false` with empty `streams` for a series, while
  `…&season=1&episode=1` returns real sources. For a film, omitting both works.
- The provider already supplies **proxied** variants beside the direct CDN URLs.
  VEYRA plays the proxied `streamUrl` and keeps the direct URL only as a retry
  fallback, because the proxy carries the referer and CORS headers a WebView
  needs.
- **URLs are signed and expire.** The `t=` parameter is a unix expiry stamp; the
  normalizer turns it into `expiresAt` so the player can re-resolve before a
  stale link causes a mysterious failure. The API layer never memoises media.
- **Qualities are whatever the title actually has.** *Inception* returned
  1080p/480p/360p, a Korean series returned 1080p/480p. Nothing is invented.
- **No per-episode titles exist.** `data.resource.seasons[]` carries
  `{ se, maxEp, resolutions[] }`, so VEYRA derives `Episode 1…N` from the real
  count instead of hardcoding a number.
- **HLS/DASH arrays exist and were empty** on every title probed; the normalizer
  handles them when populated but does not assume they are.

## What is real and what is a limitation

Verified working against the live provider from this workspace: health,
homepage + rails, trending (paged), hot, popular searches, search (paged),
suggestions, details with cast, episodes, recommendations, media resolution
with real qualities and captions, per-quality stream re-resolution, and
download URL construction.

Not verifiable from this workstation:

- **Media bytes.** `bcdnxw.hakunaymatata.com` answered `429` for a direct
  range request and the `/api/proxy` relay answered
  `500 "The operation was aborted due to timeout"` from this datacenter IP.
  Catalogue and metadata are therefore fully verified end-to-end; actual video
  delivery must be confirmed on a real device or a normal network.
- **The Android APK** — no JDK or Android SDK exists in this sandbox.
- **Native file persistence for downloads** — the queue, state machine,
  measured progress and Range resume are implemented and unit-tested, but
  writing to device storage needs a Capacitor filesystem plugin and a real
  device.

## Configuration

| Variable | Where | Purpose |
| --- | --- | --- |
| `VITE_VEYRA_API_BASE_URL` | build (public) | Base of the VEYRA API layer. Empty means same origin. A Capacitor build needs an absolute `https://` URL. |
| `ZST_API_KEY` | server only | Provider credential. Never prefix with `VITE_`. |
| `ZST_API_BASE_URL` | server only | Defaults to `https://zstlab.cyou/api`. |
| `ZST_MEDIA_PROXY_BASE_URL` | server only | Defaults to `https://api.zstlab.cyou`. |
| `VEYRA_CORS_ORIGINS` | server only | Extra comma-separated origins allowed to call the API. |

`public/sw.js` and the app shell never receive a credential; the Android assets
contain only `VITE_VEYRA_API_BASE_URL`.

## Operating VEYRA

```bash
# Backend (needs ZST_API_KEY in the environment)
npm run api                       # http://0.0.0.0:8787

# Web client
VITE_VEYRA_API_BASE_URL=          # empty: same origin
npm run dev                       # mounts the same route table in-process

# Checks
npm test
npm run build
```

`security review` — the repository was searched for `zst_`, `ZST_API_KEY=`,
`VITE_ZST_API_KEY=`, `apikey=`, `x-api-key` and `Authorization=`. The key
appears only in `.env.local`, which is ignored by Git; no tracked file contains
a credential.

> **Rotate the exposed key.** The key shared in the task text has been handled
> as compromised: generate a new one at the provider and set it as the
> deployment secret. Nothing in this repository has to change when you do.
