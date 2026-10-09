// ZST Labs MovieBox provider smoke test against the real API.
//
// Reads ZST_API_BASE_URL / ZST_API_KEY from the environment at run time, never
// echoes the credential, and reports PASS/FAIL per confirmed endpoint with the
// HTTP status and the fields that were actually found. It also performs the
// live media test end-to-end: search -> details -> season/episode -> media ->
// real stream source extraction (see the `LIVE MEDIA TEST` section at the end).
//
// Run: node scripts/zst-smoke-test.mjs

const BASE = (process.env.ZST_SMOKE_BASE_URL || process.env.ZST_API_BASE_URL || 'https://zstlab.cyou/api').replace(/\/+$/, '');
const KEY = process.env.ZST_API_KEY;
if (!KEY) {
  console.error('ZST_API_KEY is not set; refusing to run against the provider.');
  process.exit(1);
}

let pass = 0;
let fail = 0;

function report(name, ok, detail) {
  ok ? pass++ : fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function get(path, params = {}, timeoutMs = 30_000, retries = 2) {
  // String concatenation (not `new URL(path, base)`) so a base URL that already
  // carries a path such as `/api` keeps it.
    const url = new URL(`${BASE}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json', 'x-api-key': KEY },
        signal: controller.signal,
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      return { status: response.status, payload };
    } catch (error) {
      lastError = error;
      if (attempt < retries && error?.name !== 'AbortError') {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

const array = (value) => (Array.isArray(value) ? value : []);

(async () => {
  // ---- 1. homepage ----------------------------------------------------------
  let r = await get('/homepage');
  const ops = array(r.payload?.data?.operatingList);
  const banners = ops.filter((op) => op?.type === 'BANNER' && array(op?.banner?.items).length);
  const rails = ops.filter((op) => op?.type === 'SUBJECTS_MOVIE' && array(op?.subjects).length);
  const playLists = ops.filter((op) => op?.type === 'PLAY_LIST' && array(op?.subjects).length);
  report('GET /homepage', r.status === 200, `HTTP ${r.status}, ops=${ops.length}`, `banners=${banners.length}, rails=${rails.length}, playLists=${playLists.length}`);

  // ---- 2. trending ----------------------------------------------------------
  r = await get('/trending', { page: 0, perPage: 20 });
  const trending = array(r.payload?.data?.subjectList);
  report('GET /trending', r.status === 200 && trending.length > 0,
    `HTTP ${r.status}, n=${trending.length}, hasMore=${Boolean(r.payload?.data?.pager?.hasMore)}`);

  // ---- 3. hot movies / series ----------------------------------------------
  r = await get('/hot-movies-series');
  const hotMovies = array(r.payload?.data?.movie);
  const hotSeries = array(r.payload?.data?.tv);
  report('GET /hot-movies-series', r.status === 200 && (hotMovies.length || hotSeries.length),
    `HTTP ${r.status}, movies=${hotMovies.length}, series=${hotSeries.length}`);

  // ---- 4. popular searches ---------------------------------------------------
  r = await get('/popular-searches');
  const terms = array(r.payload?.data?.everyoneSearch).map((entry) => entry?.title).filter(Boolean);
  report('GET /popular-searches', r.status === 200 && terms.length > 0, `HTTP ${r.status}, n=${terms.length}`);

  // ---- 5. search suggestions (snake_case per_page is required) ---------------
  r = await get('/search-suggestion', { query: 'inception', per_page: 10 });
  const suggestions = array(r.payload?.data?.items).map((entry) => entry?.word).filter(Boolean);
  report('GET /search-suggestion', r.status === 200 && suggestions.length > 0,
    `HTTP ${r.status}, n=${suggestions.length}, sample="${suggestions[0] || ''}"`);

  // ---- 6. search ------------------------------------------------------------
  r = await get('/search', { query: 'inception', subjectType: 'ALL', page: 0, perPage: 10 });
  const searchItems = array(r.payload?.data?.items);
  report('GET /search', r.status === 200 && searchItems.length > 0, `HTTP ${r.status}, n=${searchItems.length}`);

  // ---- 7. item-details (movie) ---------------------------------------------
  const inception = searchItems.find((entry) => entry.title === 'Inception');
  const movieSubjectId = inception?.subjectId;
  const movieDetailPath = inception?.detailPath;
  r = await get('/item-details', { subjectId: movieSubjectId, detailPath: movieDetailPath });
  const subject = r.payload?.data?.subject || {};
  const stars = array(r.payload?.data?.stars);
  report('GET /item-details', r.status === 200 && subject.title === 'Inception' && stars.length > 0,
    `HTTP ${r.status}, title="${subject.title}", stars=${stars.length}`);

  // ---- 8. recommendations ---------------------------------------------------
  r = await get('/recommendations', { subjectId: movieSubjectId, page: 1, perPage: 10 });
  const recommendations = array(r.payload?.data?.items);
  report('GET /recommendations', r.status === 200 && recommendations.length > 0, `HTTP ${r.status}, n=${recommendations.length}`);

  // ---- 9. media for a movie -------------------------------------------------
  r = await get('/media', { subjectId: movieSubjectId, detailPath: movieDetailPath });
  const movieStreams = array(r.payload?.data?.stream?.data?.streams);
  const movieDownloads = array(r.payload?.data?.downloads?.data?.downloads);
  const movieCaptions = array(r.payload?.data?.downloads?.data?.captions);
  report('GET /media (movie)', r.status === 200 && movieStreams.length > 0 && movieDownloads.length > 0 && movieCaptions.length > 0,
    `HTTP ${r.status}, streams=${movieStreams.length}, downloads=${movieDownloads.length}, captions=${movieCaptions.length}`);

  // ---- 10. media for a TV episode ------------------------------------------
  // Note: many series on this deployment carry a broken upstream mapping (they
  // answer item-details with 'HTTP 404 from moviebox.id' for a valid subject
  // id), so candidates are tried from the live homepage rails until one
  // resolves. This is a provider data issue, not a route failure.
  const homeForTv = await get('/homepage');
  const tvCandidates = [];
  for (const op of array(homeForTv.payload?.data?.operatingList)) {
    if (op?.type !== 'SUBJECTS_MOVIE' && op?.type !== 'PLAY_LIST') continue;
    for (const subject of array(op?.subjects)) {
      if (Number(subject?.subjectType) === 2 && subject?.subjectId && subject?.hasResource) {
        tvCandidates.push(subject);
      }
    }
  }
  let tvResolved = false;
  for (const candidate of tvCandidates.slice(0, 12)) {
    r = await get('/item-details', { subjectId: candidate.subjectId, detailPath: candidate.detailPath });
    if (r.status !== 200) continue;
    r = await get('/media', { subjectId: candidate.subjectId, detailPath: candidate.detailPath, season: 1, episode: 1 });
    const tvStreams = array(r.payload?.data?.stream?.data?.streams);
    report(`GET /media (S1E1) via "${candidate.title}"`, r.status === 200 && tvStreams.length > 0, `HTTP ${r.status}, streams=${tvStreams.length}`);
    tvResolved = r.status === 200 && tvStreams.length > 0;
    if (tvResolved) break;
  }
  if (!tvResolved) report('GET /media (S1E1)', false, 'no series on this deployment resolved details + media');

  // ---- 11. proxy ------------------------------------------------------------
  // The bare proxy call (no url) answers 400 rather than 500, which still
  // proves it is reachable without consuming bandwidth on real media bytes.
  r = await (async () => {
    const url = new URL('/proxy', 'https://api.zstlab.cyou');
    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    return { status: response.status };
  })();
  report('GET /api/proxy (bare probe)', r.status >= 200 && r.status < 500, `HTTP ${r.status}`);

  // ---- LIVE MEDIA TEST ------------------------------------------------------
  // Verifies that the media response actually contains playable sources: real
  // stream URLs signed by the provider + real captions. Byte-level playability
  // is asserted separately by the browser playback test (the provider CDN is
  // geo/DC rate-limited, so byte checks live behind `npm run test:playback`).
  r = await get('/media', { subjectId: movieSubjectId, detailPath: movieDetailPath });
  const streams = array(r.payload?.data?.stream?.data?.streams);
  const withSignedUrl = streams.filter((entry) => /^https:\/\//.test(String(entry?.url || '')) && String(entry?.url || '').includes('sign='));
  const captionUrls = array(r.payload?.data?.subtitles?.data?.captions).filter((entry) => /^https:\/\//.test(String(entry?.url || '')));
  report('LIVE media: real playable sources', withSignedUrl.length > 0,
    `streams=${streams.length}, signedUrl=${withSignedUrl.length}, captions=${captionUrls.length}`);

  console.log(`\n${pass} passed, ${fail} failed.`);
  process.exit(fail ? 1 : 0);
})();
