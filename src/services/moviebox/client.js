const DEFAULT_TIMEOUT_MS = 12_000;
const VITE_ENV = import.meta.env || {};
const API_BASE_URL = String(VITE_ENV.VITE_MOVIEBOX_API_BASE_URL || '').trim().replace(/\/+$/, '');

export class MovieBoxServiceError extends Error {
  constructor(message, { status = 0, code = 'MOVIEBOX_ERROR', endpoint = '' } = {}) {
    super(message);
    this.name = 'MovieBoxServiceError';
    this.status = status;
    this.code = code;
    this.endpoint = endpoint;
  }
}

export function getMovieBoxApiBaseUrl() {
  return API_BASE_URL;
}

function requireApiBaseUrl() {
  if (!API_BASE_URL) {
    throw new MovieBoxServiceError(
      'MovieBox API is not configured. Set VITE_MOVIEBOX_API_BASE_URL to an authorized API deployment.',
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
    throw new MovieBoxServiceError('The production MovieBox API URL must use HTTPS.', { code: 'INSECURE_API_BASE_URL' });
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

async function readErrorPayload(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(path, params = {}, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = buildUrl(path, params);
  const controller = new AbortController();
  let timedOut = false;
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const abortFromCaller = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    const payload = await readErrorPayload(response);
    if (!response.ok) {
      throw new MovieBoxServiceError(
        payload?.error || payload?.message || `MovieBox API returned HTTP ${response.status}.`,
        { status: response.status, code: response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', endpoint: path },
      );
    }
    if (!payload || typeof payload !== 'object') {
      throw new MovieBoxServiceError('MovieBox API returned an invalid JSON response.', { code: 'INVALID_RESPONSE', endpoint: path });
    }
    if (payload.status === 'error' || payload.success === false) {
      throw new MovieBoxServiceError(payload.error || payload.message || 'MovieBox API reported an error.', {
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
        timedOut ? 'MovieBox API request timed out.' : 'MovieBox API request was cancelled.',
        { code: timedOut ? 'TIMEOUT' : 'ABORTED', endpoint: path },
      );
    }
    throw new MovieBoxServiceError('Could not reach the configured MovieBox API.', {
      code: 'NETWORK_ERROR',
      endpoint: path,
    });
  } finally {
    globalThis.clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

export const movieBoxClient = Object.freeze({
  getHomepage: (options) => request('/api/homepage', {}, options),
  getTrending: ({ page = 0, perPage = 18, signal } = {}) => request('/api/trending', { page, perPage }, { signal }),
  getHotMoviesAndSeries: (options) => request('/api/hot-movies-series', {}, options),
  getPopularSearches: (options) => request('/api/popular-searches', {}, options),
  search: ({ query, subjectType = 'ALL', page = 1, perPage = 24, signal }) => request('/api/search', { query, subjectType, page, perPage }, { signal }),
  getSearchSuggestions: ({ query, perPage = 10, signal }) => request('/api/search-suggestions', { query, perPage }, { signal }),
  getItemDetails: ({ subjectId, signal }) => request('/api/item-details', { subjectId }, { signal }),
  getRecommendations: ({ subjectId, page = 1, perPage = 24, signal }) => request('/api/recommendations', { subjectId, page, perPage }, { signal }),
});

export async function checkMovieBoxApi({ signal, timeoutMs = 5000 } = {}) {
  const base = requireApiBaseUrl();
  // The supplied API repository does not define /health. Use a safe, read-only
  // metadata endpoint rather than assuming a health route exists.
  await request('/api/homepage', {}, { signal, timeoutMs });
  return { reachable: true, baseUrl: base, endpoint: '/api/homepage' };
}
