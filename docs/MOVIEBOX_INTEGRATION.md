# VEYRA catalog integration and media boundary

## Current status

VEYRA now has a dedicated client for the JSON catalog endpoints and normalizes returned objects before rendering them. The client does not contain an API default: set `VITE_MOVIEBOX_API_BASE_URL` to an API deployment that you control or are authorized to use. Nothing in a `VITE_*` variable is secret; it is compiled into the web bundle and the Capacitor Android assets.

The API source inspected for this work is `Godszeal/movieboxapi` at `71063902ba30dc264adad65cecb8146631e47c36`. Its README advertises `https://movieboxapigz.vercel.app/`, but the repository has no `/health` route and the advertised host did not complete a TLS connection from this sandbox during the audit. The deployment and live API response are therefore **NOT VERIFIED**. Use `/api/homepage` as a read-only application reachability check only after configuring an authorized deployment.

## Screen → service → endpoint → transformation → UI

| VEYRA screen/feature | Service function | MovieBox API route | Transformation and UI |
| --- | --- | --- | --- |
| Home | `movieBoxClient.getHomepage()` | `GET /api/homepage` | Extracts content arrays into named rails; first valid content record is the featured item. `HomeScreen` renders live records or an explicit empty/error state. |
| Home / Discover | `getTrending()` | `GET /api/trending?page=0&perPage=18` | Normalizes returned items and adds a Trending rail; `DiscoverScreen` filters the loaded catalog by type and genre. |
| Home / Discover | `getHotMoviesAndSeries()` | `GET /api/hot-movies-series` | Normalizes returned items and adds a Hot Movies & Series rail. |
| Search idle state | `getPopularSearches()` | `GET /api/popular-searches` | Extracts returned search terms; no hardcoded popular queries. |
| Search typing | `search()` | `GET /api/search?query=…&subjectType=ALL\|MOVIES\|TV_SERIES&page=1&perPage=24` | Debounced, abortable request. `extractContentList()` normalizes either `items` or nested `data.items`, consistent with the route's own legacy/H5 fallback check. |
| Search suggestions | `getSearchSuggestions()` | `GET /api/search-suggestions?query=…&perPage=10` | Uses returned `items`/`data.items` or terms. The API also exposes `/api/search-suggestion` as an alias; VEYRA uses the plural route. |
| Title details | `getItemDetails()` | `GET /api/item-details?subjectId=…` | Preserves `subjectId` and `detailPath`; maps title metadata and only renders season/episode arrays explicitly present in the response. |
| Related titles | `getRecommendations()` | `GET /api/recommendations?subjectId=…&page=1&perPage=24` | Normalizes returned records into the existing “More like this” rail. Empty results remain empty. |
| My List | local VEYRA state | No MovieBox endpoint | Stores compact provider references (provider item ID, detail path, title, artwork and display metadata) in `veyra-list:v2`. Restoring the list rejects entries without a MovieBox provider reference, so legacy sample-title entries are not rendered. |
| Continue Watching / History | Local VEYRA state | No MovieBox endpoint in the supplied API | Legacy simulated watch positions are cleared; no example progress is loaded. These views remain empty until actual media playback is safely integrated and can report `currentTime`/`duration`. |
| Playback / quality / subtitles / downloads / offline media | **Not connected** | `/api/stream`, `/api/media`, `/api/subtitles`, `/api/proxy`, `/api/proxy-download` are intentionally not called | The supplied implementation does not provide enough evidence of authorized media delivery; its proxy also contains circumvention behavior described below. VEYRA shows an explicit unavailable state and does not fabricate media URLs, quality choices, captions, player progress, files, or download progress. |

The client unwraps the route envelope's `data` property and uses the route's actual query names. The API repository uses an upstream `{ code, message, data }` response internally; most routes return `{ status, statusCode, data }`, while search also returns `query`, `subjectType`, `page`, `perPage`, and `source`. Item field schemas are typed as `any` in that repository, so the VEYRA adapter accepts only records with a display title and a provider identifier or `detailPath`; it does not manufacture IDs. Season and episode values are retained only when explicit values exist. The API does not document the season/episode indexing convention.

## Why media routes are disabled

This is a source-code finding, not an inference from endpoint names:

- `lib/moviebox-client.ts` sends hardcoded `X-Forwarded-For`, `CF-Connecting-IP`, and `X-Real-IP` values of `1.1.1.1`; it bootstraps a bearer token through an unrelated search-suggestion request.
- Stream requests construct a `fmoviesunblocked.net` referer. The v2 client uses `videodownloader.site` as its referer.
- `app/api/proxy/route.ts` retries with browser-style identities and external public relay services after upstream 403/426/429 responses. The proxy accepts an arbitrary `url` target; it is not a safe general-purpose proxy.
- `app/api/proxy-download/route.ts` similarly applies identity headers and relay fallbacks. The `.env.example` sets a FMovies referer.
- `/api/stream` accepts `quality`, but the route only echoes it as `requestedQuality`; `MovieBoxClient.getStream()` does not send quality upstream. This is not verified quality selection.
- `/api/subtitles` aliases the combined downloads/captions upstream request; the repository does not define a stable subtitle schema or a conversion/attachment flow.
- Proxy source code attempts to forward HTTP Range and response headers, but no live 206/range test was possible, and range forwarding alone is not proof of authorized or working playback.

These mechanisms appear designed to evade upstream identity/referrer restrictions and relay media. Until the upstream rights and service authorization are established and the proxy is replaced or confirmed safe, VEYRA does not call media or proxy routes. Do not configure a production API URL merely because the README advertises one. For a licensed provider, add a documented, authorized stream/download contract and verify it before enabling these features.

## Deployment and configuration

The inspected API repository is Next.js 15 / Node.js 20+ and recommends Vercel for JSON routes plus a separate persistent Node host for media delivery. These are repository deployment instructions, not a verified deployment. It exposes wildcard `Access-Control-Allow-Origin: *` headers on its JSON routes; it has no health route in the checked-out source. The remote deployment, credentials, proxy host, CORS in production, and upstream behavior were not verified.

1. Deploy or select an API that you control and are authorized to use.
2. Set `VITE_MOVIEBOX_API_BASE_URL=https://<your-api-host>` in the Vite build environment. Local development may use `.env.local` with a local API host; `.env*` files other than `.env.example` are ignored by Git.
3. Rebuild the web app and run `npx cap sync android` after setting the variable. The base URL is public configuration and will be visible in the web and APK bundles.
4. Keep all upstream credentials and private tokens on the API server. Never add them to `VITE_*`, browser storage, this repository, or the APK.
5. The MovieBox wrapper has no health route. Once the deployment is authorized, a successful `GET /api/homepage` is the configured application check.

## Local development and verification

```bash
npm ci
cp .env.example .env.local
# Replace the example value with an authorized API base URL.
npm run dev
npm test
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

Without `VITE_MOVIEBOX_API_BASE_URL`, catalog and search requests fail closed with a configuration message; no bundled sample catalog is used. Do not use the public MovieBox URL as a test source unless you have permission to do so. Actual catalog/search response verification, API deployment health, streaming, subtitles, downloads, offline playback, Android media behavior, and real-device testing remain **NOT VERIFIED**.
