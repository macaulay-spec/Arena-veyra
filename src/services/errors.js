// VEYRA client errors.
//
// One stable code vocabulary shared by the API client, the media service and
// the download manager. Codes are what the logs record and what `copy.js`
// translates; a viewer never sees this file's contents.

export class VeyraError extends Error {
  constructor(code, message, { status = 0, retryable = false, cause } = {}) {
    super(message || code);
    this.name = 'VeyraError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

export const ErrorCodes = Object.freeze({
  // Transport
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK_ERROR',
  ABORTED: 'ABORTED',
  RATE_LIMITED: 'RATE_LIMITED',
  SERVER: 'SERVER_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  UNKNOWN: 'UNKNOWN',
  // Service-level
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  CATALOG_UNAVAILABLE: 'CATALOG_UNAVAILABLE',
  PLAYBACK_UNAVAILABLE: 'PLAYBACK_UNAVAILABLE',
  MEDIA_UNAVAILABLE: 'MEDIA_UNAVAILABLE',
  SUBTITLES_UNAVAILABLE: 'SUBTITLES_UNAVAILABLE',
  DOWNLOAD_UNAVAILABLE: 'DOWNLOAD_UNAVAILABLE',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
});

/** Codes that are worth another attempt without asking the viewer. */
// 429 is deliberately absent: retrying a rate limit after a few hundred
// milliseconds only amplifies it. RATE_LIMITED surfaces to the viewer for a
// manual, backed-off retry instead.
const RETRYABLE_HTTP = new Set([408, 425, 500, 502, 503, 504]);

export function isCancellation(error) {
  return error?.code === ErrorCodes.ABORTED || error?.name === 'AbortError';
}

/** Map an HTTP status from the VEYRA API onto a client code. */
export function codeForStatus(status) {
  if (status === 400 || status === 422) return ErrorCodes.BAD_REQUEST;
  if (status === 404) return ErrorCodes.NOT_FOUND;
  if (status === 429) return ErrorCodes.RATE_LIMITED;
  if (status >= 500) return ErrorCodes.SERVER;
  return ErrorCodes.UNKNOWN;
}

export function isRetryableStatus(status) {
  return RETRYABLE_HTTP.has(status);
}

/**
 * Wrap anything thrown during a request into a VeyraError. `AbortError` from
 * the platform becomes ABORTED so callers can stay silent about it.
 */
export function toVeyraError(error, { signal } = {}) {
  if (error instanceof VeyraError) return error;
  if (error?.name === 'AbortError' || signal?.aborted) {
    return new VeyraError(ErrorCodes.ABORTED, 'Request cancelled.');
  }
  if (error instanceof TypeError) {
    // `fetch` rejects with a TypeError for DNS, TLS and offline failures.
    return new VeyraError(ErrorCodes.NETWORK, 'Could not reach the VEYRA service.', { retryable: true, cause: error });
  }
  return new VeyraError(ErrorCodes.UNKNOWN, 'Request failed.', { cause: error });
}
