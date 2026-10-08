/**
 * ZST Labs MovieBox API client.
 *
 * Configuration is read from Vite environment variables:
 *   VITE_MOVIEBOX_API_BASE_URL  e.g. https://api.zstlab.cyou
 *   VITE_ZST_API_KEY            sent on every request as `x-api-key`
 *
 * Both values are PUBLIC: Vite inlines them into the web bundle and the
 * Capacitor Android assets. There is no backend service in this project and
 * VEYRA does not pretend there is one.
 *
 * Only the documented routes below are ever called. See docs/MOVIEBOX_INTEGRATION.md.
 */
const DEFAULT_TIMEOUT_MS = 12_000;
const MEDIA_TIMEOUT_MS = 16_000;

// The provider allows roughly 300 requests / 5 minutes. Metadata is cached and
// identical in-flight requests are shared, so a normal browsing session stays
// far below the ceiling.
const RATE_WINDOW_MS = 5 * 60_000;
const RATE_LIMIT = 300;
const RATE_GUARD = 240;
const MAX_RATE_WAIT_MS = 4_000;

const VITE_ENV = import.meta.env || {};
const API_BASE_URL = String(VITE_ENV.VITE_MOVIEBOX_API_BASE_URL || '').trim().replace(/\/+$/, '');
const API_KEY = String(VITE_ENV.VITE_ZST_API_KEY || '').trim();

export class MovieBoxServiceError extends Error {
  constructor(message, { status = 0, code = 'MOVIEBOX_ERROR', endpoint = '', retryAfter = 0 } = {}) {
    super(message);
    this.name = 'MovieBoxServiceError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
    this.retryAfter = retryAfter;
  }
}

export function getMovieBoxApiBaseUrl() {
  return API_BASE_URL;
}

export function getMovieBoxApiKey() {
  return API_KEY;
}

export function isMovieBoxConfigured() {
  return Boolean(API_BASE_URL);
}

/** Cache lifetimes, in milliseconds, for the metadata routes VEYRA calls. */
export const CACHE_TTL_MS = Object.freeze({
  homepage: 10 * 60_000,
  trending: 10 * 60_000,
  hot: 10 * 60_000,
  popular: 10 * 60_000,
  suggestions: 60_000,
  details: 5 * 60_000,
  recommendations: 5 * 60_000,
  // Stream URLs are signed and expire, so media is cached for one minute at
  // most and is re-requested on every play or quality change.
  media: 60_000,
});

function requireApiBaseUrl() {
  if (!API_BASE_URL) {
    throw new MovieBoxServiceError(
      'The catalog API is not configured. Set VITE_MOVIEBOX_API_BASE_URL (and VITE_ZST_API_KEY) at build time.',
      { code: 'API_NOT_CONFIGURED' },
    );
  }
  let parsed;
  try {
    parsed = new URL(API_BASE_URL);
  } catch {
    throw new MovieBoxServiceError('VITE_MOVIEBOX_API_BASE_URL must be an absolute HTTP(S) URL.', { code: 'INVALID_API_BASE_URL' });
  }
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new MovieBoxServiceError('VITE_MOVIEBOX_API_BASE_URL must use HTTP or HTTPS.', { code: 'INVALID_API_BASE_URL' });
  }
  if (VITE_ENV.PROD && parsed.protocol !== 'https:') {
    throw new MovieBoxServiceError('The production catalog API URL must use HTTPS.', { code: 'INSECURE_API_BASE_URL' });
  }
  return API_BASE_URL;
}

function buildUrl(path, params = {}) {
  const base = requireApiBaseUrl();
  const url = new URL(`${base}${path}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url;
}

/**
 * Wrap an upstream media/caption URL in the provider's own proxy route.
 * VEYRA never hands a raw CDN URL to a <video> element: CDN hosts answer 429
 * without the proxy. `streamUrl` from /api/media is already proxied; this is
 * only used when the provider returns a bare CDN `url` instead.
 */
export function buildApiProxyUrl(targetUrl) {
  const source = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  if (!/^https?:\/\//i.test(source)) return undefined;
  const base = getMovieBoxApiBaseUrl();
  if (!base) return undefined;
  return `${base}/api/proxy?url=${encodeURIComponent(source)}`;
}

/**
 * True when a URL already points at the provider's own proxy routes.
 * Detected by path, not by host, so the helper keeps working if the API is
 * served from a different hostname than the configured base.
 */
export function isApiProxyUrl(targetUrl) {
  const source = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  if (!/^https?:\/\//i.test(source)) return false;
  try {
    const parsed = new URL(source);
    return /\/api\/(proxy|proxy-download)\b/.test(parsed.pathname) && parsed.searchParams.has('url');
  } catch {
    return false;
  }
}

/** Read the upstream URL out of an /api/proxy or /api/proxy-download link. */
export function unwrapApiProxyUrl(targetUrl) {
  const source = typeof targetUrl === 'string' ? targetUrl.trim() : '';
  if (!isApiProxyUrl(source)) return undefined;
  try {
    const parsed = new URL(source);
    return parsed.searchParams.get('url') || undefined;
  } catch {
    return undefined;
  }
}

function buildHeaders() {
  const headers = { Accept: 'application/json' };
  if (API_KEY) headers['x-api-key'] = API_KEY;
  // A browser runtime always sends its own User-Agent and silently drops this
  // entry (it is a forbidden header name in fetch). Native HTTP clients that
  // honour it — e.g. CapacitorHttp in the Android build — send it through.
  if (typeof navigator !== 'undefined' && navigator.userAgent) headers['User-Agent'] = navigator.userAgent;
  return headers;
}

/* ------------------------------------------------------------------ */
/* Response cache + in-flight de-duplication                           */
/* ------------------------------------------------------------------ */

const responseCache = new Map();
const inflightRequests = new Map();

function readCache(key) {
  if (!key) return undefined;
  const hit = responseCache.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  return hit.value;
}

function writeCache(key, value, ttlMs) {
  if (!key || !(ttlMs > 0)) return;
  responseCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function clearMovieBoxCache(prefix = '') {
  if (!prefix) {
    responseCache.clear();
    return;
  }
  for (const key of responseCache.keys()) if (key.startsWith(prefix)) responseCache.delete(key);
}

function abortError(reason) {
  return new MovieBoxServiceError(
    reason === 'timeout' ? 'Catalog API request timed out.' : 'Catalog API request was cancelled.',
    { code: reason === 'timeout' ? 'TIMEOUT' : 'ABORTED' },
  );
}

/** Attach a caller's AbortSignal to a promise that is shared between callers. */
function abortable(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError('aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

/* ------------------------------------------------------------------ */
/* Rate limiting                                                       */
/* ------------------------------------------------------------------ */

const requestTimes = [];

async function respectRateLimit() {
  const prune = () => {
    const now = Date.now();
    while (requestTimes.length && now - requestTimes[0] > RATE_WINDOW_MS) requestTimes.shift();
  };
  prune();
  if (requestTimes.length >= RATE_LIMIT) {
    throw new MovieBoxServiceError(
      'The catalog API is rate limited right now. VEYRA cached what it already has — try again in a minute.',
      { code: 'RATE_LIMITED' },
    );
  }
  if (requestTimes.length >= RATE_GUARD) {
    const waitMs = Math.min(MAX_RATE_WAIT_MS, Math.max(0, RATE_WINDOW_MS - (Date.now() - requestTimes[0])));
    if (waitMs > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, waitMs));
    prune();
  }
  requestTimes.push(Date.now());
}

/* ------------------------------------------------------------------ */
/* Request core                                                        */
/* ------------------------------------------------------------------ */

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function mapStatusToError(response, payload, endpoint) {
  const status = response.status;
  const retryAfter = Number(response.headers?.get?.('retry-after')) || 0;
  if (status === 429) {
    return new MovieBoxServiceError(
      'The catalog API is rate limited (HTTP 429). Cached titles still work — retry shortly.',
      { status, code: 'RATE_LIMITED', endpoint, retryAfter },
    );
  }
  if (status === 401 || status === 403) {
    return new MovieBoxServiceError(
      'The catalog API rejected VEYRA’s API key. Check VITE_ZST_API_KEY and rebuild.',
      { status, code: 'UNAUTHORIZED', endpoint },
    );
  }
  if (status === 404) {
    return new MovieBoxServiceError('The catalog API has no such title or route (HTTP 404).', { status, code: 'NOT_FOUND', endpoint });
  }
  return new MovieBoxServiceError(
    payload?.error || payload?.message || `The catalog API returned HTTP ${status}.`,
    { status, code: 'HTTP_ERROR', endpoint },
  );
}

async function performRequest(path, params, { signal, timeoutMs, ttlMs, cacheKey, fresh }) {
  const base = requireApiBaseUrl();
  const url = buildUrl(path, params);
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  const resolvedKey = cacheKey ? `${base}|${cacheKey}` : '';
  if (!fresh) {
    const cached = readCache(resolvedKey);
    if (cached !== undefined) {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
      return cached;
    }
  }

  const run = async () => {
    await respectRateLimit();
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: buildHeaders(),
        signal: controller.signal,
        cache: 'no-store',
      });
      const payload = await readJson(response);
      if (!response.ok) throw mapStatusToError(response, payload, path);
      if (!payload || typeof payload !== 'object') {
        throw new MovieBoxServiceError('The catalog API returned an invalid JSON response.', { code: 'INVALID_RESPONSE', endpoint: path });
      }
      if (payload.status === 'error' || payload.success === false) {
        throw new MovieBoxServiceError(payload.error || payload.message || 'The catalog API reported an error.', {
          status: Number(payload.statusCode) || response.status,
          code: 'API_ERROR',
          endpoint: path,
        });
      }
      return payload.data ?? payload;
    } catch (error) {
      if (error instanceof MovieBoxServiceError) throw error;
      if (error?.name === 'AbortError') {
        throw new MovieBoxServiceError(
          timedOut ? 'The catalog API request timed out.' : 'The catalog API request was cancelled.',
          { code: timedOut ? 'TIMEOUT' : 'ABORTED', endpoint: path },
        );
      }
      throw new MovieBoxServiceError('Could not reach the catalog API. Check your connection and try again.', {
        code: 'NETWORK_ERROR',
        endpoint: path,
      });
    } finally {
      globalThis.clearTimeout(timer);
      signal?.removeEventListener('abort', abortFromCaller);
    }
  };

  if (!resolvedKey) return run();

  const existing = inflightRequests.get(resolvedKey);
  if (existing) return abortable(existing, signal);

  const shared = run().then(
    (value) => {
      inflightRequests.delete(resolvedKey);
      writeCache(resolvedKey, value, ttlMs);
      return value;
    },
    (error) => {
      inflightRequests.delete(resolvedKey);
      throw error;
    },
  );
  inflightRequests.set(resolvedKey, shared);
  return abortable(shared, signal);
}

function request(path, params = {}, options = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = options;
  return performRequest(path, params, { timeoutMs, ...rest });
}

function searchResultCount(payload) {
  const candidates = [
    payload?.items, payload?.data?.items, payload?.subjectList, payload?.data?.subjectList,
    payload?.list, payload?.data?.list, payload?.results, payload?.data?.results,
  ];
  for (const candidate of candidates) if (Array.isArray(candidate) && candidate.length) return candidate.length;
  return 0;
}

export const movieBoxClient = Object.freeze({
  getHomepage: ({ signal } = {}) => request('/api/homepage', {}, { signal, ttlMs: CACHE_TTL_MS.homepage, cacheKey: 'homepage' }),
  getTrending: ({ page = 0, perPage = 18, signal } = {}) => request(
    '/api/trending',
    { page, perPage },
    { signal, ttlMs: CACHE_TTL_MS.trending, cacheKey: `trending:${page}:${perPage}` },
  ),
  getHotMoviesAndSeries: ({ signal } = {}) => request('/api/hot-movies-series', {}, { signal, ttlMs: CACHE_TTL_MS.hot, cacheKey: 'hot' }),
  getPopularSearches: ({ signal } = {}) => request('/api/popular-searches', {}, { signal, ttlMs: CACHE_TTL_MS.popular, cacheKey: 'popular' }),

  /**
   * Search. `query` is preferred; the provider also accepts `q`, which VEYRA
   * only falls back to when `query` comes back empty.
   */
  search: async ({ query, subjectType = 'ALL', page = 1, perPage = 24, signal }) => {
    const term = String(query ?? '').trim();
    if (!term) return { items: [], pager: null };
    const scope = subjectType || 'ALL';
    const scopeKey = `search:${term.toLowerCase()}:${scope}:${page}:${perPage}`;
    const primary = await request(
      '/api/search',
      { query: term, subjectType: scope, page, perPage },
      { signal, ttlMs: CACHE_TTL_MS.suggestions, cacheKey: `${scopeKey}:query` },
    );
    if (searchResultCount(primary)) return primary;
    const alias = await request(
      '/api/search',
      { q: term, subjectType: scope, page, perPage },
      { signal, ttlMs: CACHE_TTL_MS.suggestions, cacheKey: `${scopeKey}:q` },
    );
    return searchResultCount(alias) ? alias : primary;
  },

  // Singular route with the `q` parameter — /api/search-suggestions does not exist.
  getSearchSuggestions: ({ query, signal }) => {
    const term = String(query ?? '').trim();
    return request(
      '/api/search-suggestion',
      { q: term },
      { signal, ttlMs: CACHE_TTL_MS.suggestions, cacheKey: `suggestions:${term.toLowerCase()}` },
    );
  },

  getItemDetails: ({ subjectId, detailPath, signal }) => request(
    '/api/item-details',
    { subjectId, detailPath: detailPath || undefined },
    { signal, ttlMs: CACHE_TTL_MS.details, cacheKey: `details:${subjectId}:${detailPath || ''}` },
  ),

  getRecommendations: ({ subjectId, signal }) => request(
    '/api/recommendations',
    { subjectId },
    { signal, ttlMs: CACHE_TTL_MS.recommendations, cacheKey: `recommendations:${subjectId}` },
  ),

  /**
   * Media (progressive MP4 + captions) for a movie or a specific episode.
   * Movies use season 0 / episode 0 unless item-details says otherwise.
   * Pass `fresh: true` to bypass the (max 60s) cache — the player does this on
   * every play and quality change because stream URLs are signed.
   */
  getMedia: ({ subjectId, detailPath, season = 0, episode = 0, signal, fresh = false }) => request(
    '/api/media',
    { subjectId, detailPath: detailPath || undefined, season, episode },
    {
      signal,
      timeoutMs: MEDIA_TIMEOUT_MS,
      fresh,
      ttlMs: CACHE_TTL_MS.media,
      cacheKey: `media:${subjectId}:${detailPath || ''}:${season}:${episode}`,
    },
  ),
});

/**
 * Ask a media URL for its first byte. Used to tell a slow stream apart from a
 * refused one (the provider answers 426/429 when it is under maintenance or
 * rate limiting) without guessing.
 */
export async function probeMediaUrl(mediaUrl, { timeoutMs = 20_000, range = 'bytes=0-1', signal } = {}) {
  const target = typeof mediaUrl === 'string' ? mediaUrl.trim() : '';
  if (!/^https?:\/\//i.test(target)) return { ok: false, reason: 'NO_URL' };
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort();
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetch(target, {
      method: 'GET',
      headers: { Range: range, Accept: '*/*' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (response.ok || response.status === 206) return { ok: true, status: response.status, reason: 'OK' };
    return { ok: false, status: response.status, reason: `HTTP_${response.status}` };
  } catch (error) {
    if (timedOut) return { ok: false, reason: 'TIMEOUT' };
    if (error?.name === 'AbortError') return { ok: false, reason: 'ABORTED' };
    return { ok: false, reason: 'NETWORK_ERROR' };
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

/**
 * Best-effort download probe.
 *
 * The provider's proxy-download route is under maintenance and frequently
 * hangs, so VEYRA asks for the first byte and gives up after 20 seconds. No
 * progress is invented: the result is only "available" or a reason.
 */
export async function probeDownloadAvailability(downloadUrl, { timeoutMs = 20_000, signal } = {}) {
  const result = await probeMediaUrl(downloadUrl, { timeoutMs, signal });
  if (result.reason === 'NO_URL') return { available: false, reason: 'NO_DOWNLOAD_URL' };
  return { available: result.ok, reason: result.reason, status: result.status };
}

export async function checkMovieBoxApi({ signal, timeoutMs = 5000 } = {}) {
  const base = requireApiBaseUrl();
  // The provider exposes no /health route; a read-only homepage fetch is the
  // configured application check.
  await request('/api/homepage', {}, { signal, timeoutMs, fresh: true });
  return { reachable: true, baseUrl: base, endpoint: '/api/homepage' };
}
