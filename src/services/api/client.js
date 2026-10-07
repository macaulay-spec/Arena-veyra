// VEYRA API transport.
//
// The only module in the app that performs HTTP against the VEYRA API layer.
// It knows one base URL and one prefix, has no provider knowledge, holds no
// credential, and never builds a media or proxy URL.

import { ErrorCodes, VeyraError, codeForStatus, isRetryableStatus, toVeyraError } from '../errors.js';

export const API_PREFIX = '/api/veyra';

const DEFAULT_TIMEOUT_MS = 12_000;
const MEDIA_TIMEOUT_MS = 20_000;

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const CONFIGURED_BASE = String(env.VITE_VEYRA_API_BASE_URL || '').trim().replace(/\/+$/, '');

/**
 * Absolute base for the VEYRA API.
 *
 * An empty value means "same origin": the web build and the development
 * middleware serve the API from the same host. A Capacitor shell always needs
 * an absolute URL, because a relative path would resolve inside the WebView.
 */
export function apiBaseUrl() {
  if (CONFIGURED_BASE) return CONFIGURED_BASE;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return '';
}

export function isApiConfigured() {
  return Boolean(CONFIGURED_BASE) || typeof window !== 'undefined';
}

function buildUrl(path, params = {}) {
  const base = apiBaseUrl();
  const target = `${base}${API_PREFIX}${path}`;
  const url = base ? new URL(target) : new URL(target, 'http://localhost');
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Perform one VEYRA API request.
 *
 * Every call has a timeout, honours a caller `signal`, and retries only
 * idempotent reads that failed for a transient reason.
 */
export async function apiRequest(path, params = {}, {
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  retries = 1,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new VeyraError(ErrorCodes.NOT_CONFIGURED, 'Networking is unavailable in this environment.');
  }

  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
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
      const response = await fetchImpl(buildUrl(path, params), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store',
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }

      if (!response.ok) {
        const code = payload?.error?.code;
        throw new VeyraError(
          typeof code === 'string' ? code : codeForStatus(response.status),
          payload?.error?.message || `Request failed with status ${response.status}.`,
          { status: response.status, retryable: isRetryableStatus(response.status) },
        );
      }
      if (!payload || typeof payload !== 'object') {
        throw new VeyraError(ErrorCodes.INVALID_RESPONSE, 'The service returned an unusable response.');
      }
      return payload.data ?? payload;
    } catch (error) {
      if (signal?.aborted && !timedOut) throw new VeyraError(ErrorCodes.ABORTED, 'Request cancelled.');
      const normalized = error instanceof VeyraError
        ? error
        : timedOut
          ? new VeyraError(ErrorCodes.TIMEOUT, 'The service took too long to answer.', { retryable: true })
          : toVeyraError(error, { signal });
      lastError = normalized;
      if (attempt < retries && normalized.retryable) {
        await sleep(280 * (attempt + 1));
        continue;
      }
      throw normalized;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', forwardAbort);
    }
  }
  throw lastError || new VeyraError(ErrorCodes.UNKNOWN, 'Request failed.');
}

/** Playback resolution is allowed one extra attempt before it fails cleanly. */
export function mediaRequest(path, params, options = {}) {
  return apiRequest(path, params, { timeoutMs: MEDIA_TIMEOUT_MS, retries: 2, ...options });
}

export async function checkHealth({ signal, timeoutMs = 6000 } = {}) {
  try {
    const data = await apiRequest('/health', {}, { signal, timeoutMs, retries: 0 });
    return {
      reachable: true,
      catalog: data?.catalog === 'up',
      media: data?.media === 'up',
    };
  } catch (error) {
    return {
      reachable: false,
      catalog: false,
      media: false,
      code: error?.code || ErrorCodes.NETWORK,
    };
  }
}
