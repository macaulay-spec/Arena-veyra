// ZST Labs provider adapter.
//
// The only module in VEYRA that knows the provider's host names, its
// `x-api-key` header and its response envelope. Everything above it speaks
// VEYRA models, so replacing the provider means replacing this file.
//
// The API key is read from the server environment at call time. It is never
// returned to a caller, never logged, and never sent to a client.

const CATALOG_BASE = (process.env.ZST_API_BASE_URL || 'https://zstlab.cyou/api').replace(/\/+$/, '');
const MEDIA_BASE = (process.env.ZST_MEDIA_PROXY_BASE_URL || 'https://api.zstlab.cyou').replace(/\/+$/, '');

const DEFAULT_TIMEOUT_MS = 12_000;
const MEDIA_TIMEOUT_MS = 20_000;
const DEFAULT_RETRIES = 1;

export class ProviderError extends Error {
  constructor(message, { code = 'PROVIDER_ERROR', status = 0, endpoint = '', retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
    this.status = status;
    this.endpoint = endpoint;
    this.retryable = retryable;
  }
}

export function providerConfigured() {
  return Boolean(process.env.ZST_API_KEY);
}

export function providerBases() {
  // Public, non-secret configuration only.
  return { catalog: CATALOG_BASE, media: MEDIA_BASE };
}

/** Strip anything secret from a URL before it reaches a log line. */
export function redactUrl(value) {
  try {
    const url = new URL(value);
    for (const key of ['apikey', 'api_key', 'key', 'token', 'sign', 'Policy', 'Signature']) {
      if (url.searchParams.has(key)) url.searchParams.set(key, 'REDACTED');
    }
    return url.toString();
  } catch {
    return String(value).slice(0, 80);
  }
}

function log(entry) {
  // Structured, secret-free. A failure here must never break a response.
  try {
    console.log(JSON.stringify({ scope: 'zst', ...entry }));
  } catch {
    /* ignore */
  }
}

function buildUrl(base, path, params = {}) {
  const url = new URL(`${base}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function request(path, params = {}, {
  base = CATALOG_BASE,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = DEFAULT_RETRIES,
  signal,
} = {}) {
  if (!providerConfigured()) {
    throw new ProviderError('Provider credential is missing on the server.', { code: 'PROVIDER_NOT_CONFIGURED' });
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAt = Date.now();
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const forwardAbort = () => controller.abort(signal?.reason);
    if (signal?.aborted) forwardAbort();
    else signal?.addEventListener('abort', forwardAbort, { once: true });

    try {
      const url = buildUrl(base, path, params);
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          'x-api-key': process.env.ZST_API_KEY,
        },
        signal: controller.signal,
        cache: 'no-store',
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const status = response.status;
        const code = status === 401 || status === 403 ? 'PROVIDER_UNAUTHORIZED'
          : status === 429 ? 'PROVIDER_RATE_LIMITED'
            : status >= 500 ? 'PROVIDER_UNAVAILABLE'
              : 'PROVIDER_REJECTED';
        throw new ProviderError(`Provider responded ${status}.`, {
          code,
          status,
          endpoint: path,
          retryable: status === 429 || status >= 500,
        });
      }
      if (!payload || typeof payload !== 'object') {
        throw new ProviderError('Provider returned a non-JSON body.', { code: 'PROVIDER_INVALID_RESPONSE', status: response.status, endpoint: path });
      }
      if (payload.status === false || payload.error) {
        throw new ProviderError('Provider reported an error payload.', {
          code: 'PROVIDER_REJECTED',
          status: Number(payload.statusCode) || response.status,
          endpoint: path,
        });
      }

      log({ name: path, durationMs: Date.now() - startedAt, ok: true, attempt });
      return payload.data ?? payload;
    } catch (error) {
      if (error instanceof ProviderError && !error.retryable) {
        log({ name: path, durationMs: Date.now() - startedAt, ok: false, code: error.code });
        throw error;
      }
      if (error?.name === 'AbortError' && !timedOut && signal?.aborted) {
        throw new ProviderError('Request cancelled.', { code: 'PROVIDER_ABORTED', endpoint: path });
      }
      const normalized = error instanceof ProviderError
        ? error
        : new ProviderError(timedOut ? 'Provider request timed out.' : 'Provider is unreachable.', {
          code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNREACHABLE',
          endpoint: path,
          retryable: true,
        });
      lastError = normalized;
      if (attempt < retries && normalized.retryable) {
        log({ name: path, durationMs: Date.now() - startedAt, ok: false, code: normalized.code, retrying: true });
        await sleep(250 * (attempt + 1));
        continue;
      }
      log({ name: path, durationMs: Date.now() - startedAt, ok: false, code: normalized.code });
      throw normalized;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  throw lastError || new ProviderError('Provider request failed.');
}

/** Authorization wrapper for a provider media resource. */
export function proxiedStreamUrl(target) {
  return buildUrl(MEDIA_BASE, '/api/proxy', { url: target }).toString();
}

export function proxiedDownloadUrl(target) {
  return buildUrl(MEDIA_BASE, '/api/proxy-download', { url: target }).toString();
}

export const zstProvider = Object.freeze({
  name: 'zst',
  bases: providerBases,

  // The homepage payload is large (hundreds of KB), so it gets a longer budget
  // than the other catalogue routes.
  getHomepage: (options = {}) => request('/homepage', {}, { timeoutMs: 25_000, ...options }),
  getTrending: ({ page = 0, perPage = 18, ...rest } = {}) => request('/trending', { page, perPage }, rest),
  getHot: (options = {}) => request('/hot-movies-series', {}, options),
  getPopularSearches: (options = {}) => request('/popular-searches', {}, options),
  search: ({ query, subjectType = 'ALL', page = 1, perPage = 24, ...rest }) => request('/search', { query, subjectType, page, perPage }, rest),
  // The deployed route is singular; the plural spelling is a 404 on this host.
  getSuggestions: ({ query, perPage = 10, ...rest }) => request('/search-suggestion', { query, perPage }, rest),
  getItemDetails: ({ subjectId, detailPath, ...rest }) => request('/item-details', { subjectId, detailPath }, rest),
  getRecommendations: ({ subjectId, page = 1, perPage = 24, ...rest }) => request('/recommendations', { subjectId, page, perPage }, rest),

  /** Full playback package: streams, proxied variants, captions. */
  getMedia: ({ subjectId, detailPath, season, episode, ...rest }) => request('/media',
    { subjectId, detailPath, season, episode },
    { timeoutMs: MEDIA_TIMEOUT_MS, ...rest }),

  /**
   * Quality-specific re-resolution. The catalogue host answers this route from
   * the provider's own resolver; the media host is used when it rejects.
   */
  getStream: async ({ subjectId, detailPath, quality, season, episode, ...rest }) => {
    const params = { subjectId, detailPath, quality, season, episode };
    try {
      return await request('/stream', params, { timeoutMs: MEDIA_TIMEOUT_MS, ...rest });
    } catch (error) {
      if (error?.code === 'PROVIDER_ABORTED') throw error;
      return request('/stream', params, { base: MEDIA_BASE, timeoutMs: MEDIA_TIMEOUT_MS, ...rest });
    }
  },
});

export async function probeProvider({ timeoutMs = 6000 } = {}) {
  if (!providerConfigured()) return { reachable: false, code: 'PROVIDER_NOT_CONFIGURED' };
  try {
    await request('/popular-searches', {}, { timeoutMs, retries: 0 });
    return { reachable: true };
  } catch (error) {
    return { reachable: false, code: error?.code || 'PROVIDER_UNREACHABLE' };
  }
}
