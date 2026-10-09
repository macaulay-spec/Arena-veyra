// VEYRA media service.
//
// The only module that turns a title (plus an episode) into something the
// player can play. It asks the VEYRA API layer, which is the only place that
// holds provider credentials, and receives plain VEYRA objects:
//
//   { sources: [{ id, label, height, url, fallbackUrl, type, format, codec, sizeBytes }],
//     subtitles: [{ id, lang, label, url }],
//     downloads: [{ id, label, height, sizeBytes, url }] }
//
// Signed playback URLs expire, so resolved playback is memoised for a short
// window only — and any explicit quality change re-resolves for real.

import { mediaRequest } from './api/client.js';
import { readDownload, readMedia } from './api/normalize.js';
import { ErrorCodes, VeyraError, isCancellation } from './errors.js';

const CACHE_TTL_MS = 90_000;
const MAX_TTL_MS = 5 * 60_000;
const cache = new Map();

export class MediaResolutionError extends VeyraError {
  constructor(code = ErrorCodes.PLAYBACK_UNAVAILABLE, message = 'Playback is not available for this title.', options) {
    super(code, message, options);
    this.name = 'MediaResolutionError';
  }
}

export function clearMediaCache() {
  cache.clear();
}

function titleKey(item) {
  return item?.id || item?.subjectId || item?.providerItemId || 'unknown';
}

function episodeKey(episode) {
  return episode?.id || episode?.episodeNumber || 'feature';
}

/** Episode coordinates are 1-based on the wire; the provider counts the same way. */
function playbackParams(item, episode, extra = {}) {
  const subjectId = item?.subjectId || item?.providerItemId;
  const detailPath = item?.detailPath;
  if (!subjectId && !detailPath) {
    throw new MediaResolutionError(ErrorCodes.PLAYBACK_UNAVAILABLE, 'This title cannot be played yet.');
  }
  return {
    subjectId,
    detailPath,
    season: episode?.seasonNumber ?? episode?.apiSeason,
    episode: episode?.episodeNumber ?? episode?.apiEpisode,
    ...extra,
  };
}

function remember(key, media) {
  const expired = media?.expiresAt && media.expiresAt > Date.now() ? media.expiresAt : Infinity;
  const expiresAt = Math.min(Date.now() + CACHE_TTL_MS, Date.now() + MAX_TTL_MS, expired);
  cache.set(key, { media, expiresAt });
  if (cache.size > 24) cache.delete(cache.keys().next().value);
}

function recall(key, force) {
  if (force) return null;
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.media;
}

async function resolve(path, { item, episode, key, force, signal, params = {} }) {
  const cacheKey = `${key}:${titleKey(item)}:${episodeKey(episode)}`;
  const hit = recall(cacheKey, force);
  if (hit) return hit;
  let payload;
  try {
    payload = await mediaRequest(path, playbackParams(item, episode, params), { signal });
  } catch (error) {
    if (isCancellation(error)) throw error;
    throw new MediaResolutionError(
      ErrorCodes.PLAYBACK_UNAVAILABLE,
      'We could not start playback.',
      { cause: error, retryable: Boolean(error?.retryable) },
    );
  }
  const media = readMedia(payload);
  if (!media.sources.length) {
    // Distinct from a failed request: the API answered, the title simply has
    // nothing playable, so the viewer is told that instead of a connection error.
    throw new MediaResolutionError(ErrorCodes.MEDIA_UNAVAILABLE, 'Playback is not available for this title.');
  }
  remember(cacheKey, media);
  return media;
}

/** The full playback package: every real quality plus the caption tracks. */
export function resolveMedia({ item, episode, signal, force = false } = {}) {
  return resolve('/media', { item, episode, key: 'media', force, signal });
}

/**
 * Re-resolve for one quality. The API answers with a single source, so the
 * player swaps a genuinely different stream instead of relabelling one.
 */
export function resolveStream({ item, episode, quality, signal, force = true } = {}) {
  const height = Number(String(quality ?? '').replace(/[^\d]/g, ''));
  return resolve('/stream', {
    item,
    episode,
    key: `stream:${height || 'auto'}`,
    force,
    signal,
    params: height ? { quality: height } : {},
  });
}

export function resolveSubtitles({ item, episode, signal } = {}) {
  return mediaRequest('/subtitles', playbackParams(item, episode), { signal })
    .then((payload) => readMedia({ subtitles: payload?.items }).subtitles);
}

/** Authorized download metadata for one title or episode. */
export function resolveDownload({ item, episode, quality, signal } = {}) {
  const height = Number(String(quality ?? '').replace(/[^\d]/g, ''));
  return mediaRequest('/download', playbackParams(item, episode, height ? { quality: height } : {}), { signal })
    .then((payload) => {
      const download = readDownload(payload);
      if (!download) {
        throw new MediaResolutionError(ErrorCodes.DOWNLOAD_UNAVAILABLE, 'This title cannot be downloaded.');
      }
      return download;
    })
    .catch((error) => {
      if (isCancellation(error) || error instanceof MediaResolutionError) throw error;
      throw new MediaResolutionError(ErrorCodes.DOWNLOAD_UNAVAILABLE, 'This title cannot be downloaded.', { cause: error });
    });
}

function heightOf(source) {
  if (Number.isFinite(source?.height) && source.height > 0) return source.height;
  const match = /(\d{3,4})p/.exec(source?.label || '');
  return match ? Number(match[1]) : 0;
}

/** Choose the source that matches the viewer's quality preference. */
export function pickSource(media, { quality = 'Auto', dataSaver = false } = {}) {
  const sources = [...(media?.sources || [])].sort((a, b) => heightOf(b) - heightOf(a));
  if (!sources.length) return null;
  const capped = dataSaver ? sources.filter((source) => heightOf(source) <= 480) : [];
  const pool = capped.length ? capped : sources;
  if (quality === 'Auto') return pool[0];
  const wanted = Number(String(quality).replace(/[^\d]/g, ''));
  if (!wanted) return pool[0];
  return pool.find((source) => heightOf(source) === wanted)
    || pool.find((source) => heightOf(source) <= wanted)
    || pool[pool.length - 1];
}

export function pickSubtitleTrack(media, { enabled, language = 'English' } = {}) {
  const tracks = media?.subtitles || [];
  if (!enabled || !tracks.length) return null;
  const wanted = String(language).toLowerCase();
  return tracks.find((track) => (track.label || '').toLowerCase() === wanted)
    || tracks.find((track) => (track.language || '').toLowerCase() === wanted)
    || tracks.find((track) => (track.language || '').toLowerCase().startsWith(wanted.slice(0, 2)))
    || tracks[0];
}

/** Only real, returned qualities are offered — Auto plus what the title has. */
export function qualityOptions(media) {
  const seen = new Set();
  const options = [{ id: 'auto', label: 'Auto', value: 'Auto' }];
  [...(media?.sources || [])]
    .map(heightOf)
    .filter((height) => height > 0 && !seen.has(height) && seen.add(height))
    .sort((a, b) => b - a)
    .forEach((height) => options.push({ id: `${height}p`, label: `${height}p`, value: `${height}p` }));
  return options;
}
