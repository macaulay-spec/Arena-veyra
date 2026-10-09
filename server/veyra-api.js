// VEYRA API layer.
//
// Transport-agnostic route table: `handleVeyraRequest()` takes a plain request
// description and returns a plain response, so the same implementation serves
// the standalone Node server, the Vite development middleware and any Node
// host function. Clients only ever call these routes; the provider credential
// stays in this process.
//
// Error envelopes never carry upstream text, a status code, an endpoint or a
// credential. Clients map `error.code` onto viewer-facing copy.

import { ProviderError, probeProvider, providerBases, providerConfigured, zstProvider } from './providers/zst.js';
import {
  episodesFor,
  normalizeDetails,
  normalizeHomepage,
  normalizeHotPayload,
  normalizeMediaPayload,
  normalizePagedPayload,
  normalizePopularSearches,
  normalizeStreamPayload,
  normalizeSuggestions,
  normalizeTitle,
} from './normalize.js';

export const API_PREFIX = '/api/veyra';

const CATALOG_CACHE_SECONDS = 60;
const MEDIA_CACHE_SECONDS = 0;

// Stable catalogue metadata is worth re-serving for a short window; playback
// URLs are signed and expiring, so they are never memoised.
const TTL = {
  home: 120_000,
  trending: 60_000,
  hot: 60_000,
  popular: 300_000,
  details: 300_000,
  episodes: 300_000,
  recommendations: 300_000,
};

const memo = new Map();

async function cached(key, ttlMs, produce) {
  const hit = memo.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await produce();
  memo.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (memo.size > 200) memo.delete(memo.keys().next().value);
  return value;
}

/** Exact height, otherwise the closest quality below it, otherwise the lowest. */
function closestSource(sources, wanted) {
  const sorted = [...sources].sort((a, b) => (b.height ?? 0) - (a.height ?? 0));
  if (!sorted.length) return undefined;
  if (!wanted) return sorted[0];
  return sorted.find((source) => source.height === wanted)
    || sorted.find((source) => (source.height ?? 0) <= wanted)
    || sorted[sorted.length - 1];
}

class ApiError extends Error {
  constructor(code, status = 502, message = 'Request failed.') {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

/** Provider failures become stable VEYRA codes. Upstream detail stops here. */
function apiErrorFrom(error) {
  if (error instanceof ApiError) return error;
  if (error instanceof ProviderError) {
    switch (error.code) {
      case 'PROVIDER_NOT_CONFIGURED':
        return new ApiError('NOT_CONFIGURED', 503, 'The catalogue service is not configured.');
      case 'PROVIDER_UNAUTHORIZED':
        return new ApiError('CATALOG_UNAVAILABLE', 502, 'The catalogue service rejected the request.');
      case 'PROVIDER_RATE_LIMITED':
        return new ApiError('RATE_LIMITED', 429, 'Too many requests.');
      case 'PROVIDER_TIMEOUT':
        return new ApiError('UPSTREAM_TIMEOUT', 504, 'The catalogue service timed out.');
      case 'PROVIDER_ABORTED':
        return new ApiError('ABORTED', 499, 'Request cancelled.');
      case 'PROVIDER_INVALID_RESPONSE':
        return new ApiError('CATALOG_UNAVAILABLE', 502, 'The catalogue service returned an unusable response.');
      default:
        return new ApiError('CATALOG_UNAVAILABLE', 502, 'The catalogue service is unavailable.');
    }
  }
  return new ApiError('INTERNAL', 500, 'Request failed.');
}

const json = (data, { cache = CATALOG_CACHE_SECONDS } = {}) => ({
  status: 200,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache > 0 ? `public, max-age=${cache}` : 'no-store',
  },
  body: { status: true, data },
});

function requireIdentifier(query) {
  const subjectId = query.get('subjectId') || undefined;
  const detailPath = query.get('detailPath') || undefined;
  if (!subjectId && !detailPath) throw new ApiError('BAD_REQUEST', 400, 'A title identifier is required.');
  return { subjectId, detailPath };
}

function optionalInt(value) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : undefined;
}

function playbackTarget(query) {
  const { subjectId, detailPath } = requireIdentifier(query);
  const season = optionalInt(query.get('season'));
  const episode = optionalInt(query.get('episode'));
  return { subjectId, detailPath, season, episode };
}

const routes = {
  async health() {
    const catalog = providerConfigured() ? await probeProvider() : { reachable: false, code: 'PROVIDER_NOT_CONFIGURED' };
    let media = { reachable: false, code: 'UNKNOWN' };
    try {
      const response = await fetch(`${providerBases().media}/api/proxy`, { method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(5000) });
      // The proxy answers 400 for a missing url parameter, which still proves it
      // is reachable. Anything above 500 means it is not.
      media = { reachable: response.status < 500 };
    } catch {
      media = { reachable: false, code: 'MEDIA_UNREACHABLE' };
    }
    return json({
      ok: catalog.reachable,
      catalog: catalog.reachable ? 'up' : 'down',
      media: media.reachable ? 'up' : 'down',
      configured: providerConfigured(),
    }, { cache: 0 });
  },

  async home({ signal }) {
    const payload = await cached('home', TTL.home, () => zstProvider.getHomepage({ signal }));
    const { hero, rails } = normalizeHomepage(payload);
    return json({ hero, rails });
  },

  async trending({ query, signal }) {
    const page = optionalInt(query.get('page')) ?? 0;
    const perPage = optionalInt(query.get('perPage')) ?? 18;
    const payload = await cached(`trending:${page}:${perPage}`, TTL.trending,
      () => zstProvider.getTrending({ page, perPage, signal }));
    return json(normalizePagedPayload(payload));
  },

  async hot({ signal }) {
    const payload = await cached('hot', TTL.hot, () => zstProvider.getHot({ signal }));
    const { movies, series } = normalizeHotPayload(payload);
    const rails = [];
    if (movies.length) rails.push({ id: 'zst-hot:movies', title: 'Popular Movies', items: movies });
    if (series.length) rails.push({ id: 'zst-hot:series', title: 'Popular Series', items: series });
    return json({ movies, series, rails });
  },

  async 'popular-searches'({ signal }) {
    const payload = await cached('popular-searches', TTL.popular, () => zstProvider.getPopularSearches({ signal }));
    return json({ terms: normalizePopularSearches(payload) });
  },

  async search({ query, signal }) {
    const term = (query.get('query') || '').trim();
    if (!term) throw new ApiError('BAD_REQUEST', 400, 'A search term is required.');
    const subjectType = (query.get('subjectType') || 'ALL').toUpperCase();
    const page = optionalInt(query.get('page')) ?? 1;
    const perPage = Math.min(optionalInt(query.get('perPage')) ?? 24, 48);
    const payload = await zstProvider.search({ query: term, subjectType, page, perPage, signal });
    const { items, pager } = normalizePagedPayload(payload);
    return json({ query: term, subjectType, items, pager }, { cache: 0 });
  },

  async suggestions({ query, signal }) {
    const term = (query.get('query') || '').trim();
    if (!term) return json({ query: '', items: [] }, { cache: 0 });
    const payload = await zstProvider.getSuggestions({ query: term, perPage: optionalInt(query.get('perPage')) ?? 10, signal });
    return json({ query: term, items: normalizeSuggestions(payload) }, { cache: 0 });
  },

  async details({ query, signal }) {
    const { subjectId, detailPath } = requireIdentifier(query);
    const payload = await cached(`details:${subjectId || detailPath}`, TTL.details,
      () => zstProvider.getItemDetails({ subjectId, detailPath, signal }));
    const details = normalizeDetails(payload, { subjectId });
    if (!details) throw new ApiError('NOT_FOUND', 404, 'That title is not available.');
    return json(details);
  },

  async episodes({ query, signal }) {
    const { subjectId, detailPath } = requireIdentifier(query);
    const payload = await cached(`details:${subjectId || detailPath}`, TTL.details,
      () => zstProvider.getItemDetails({ subjectId, detailPath, signal }));
    const details = normalizeDetails(payload, { subjectId });
    if (!details) throw new ApiError('NOT_FOUND', 404, 'That title is not available.');
    const season = optionalInt(query.get('season'));
    const seasons = details.title.seasons || [];
    const resolvedSeason = season ?? seasons[0]?.season;
    return json({
      seasons,
      season: resolvedSeason,
      episodes: episodesFor(seasons, resolvedSeason),
    }, { cache: 300 });
  },

  async recommendations({ query, signal }) {
    const { subjectId, detailPath } = requireIdentifier(query);
    let resolvedSubjectId = subjectId;
    if (!resolvedSubjectId && detailPath) {
      // The recommendations route needs a subject id; resolve it from details
      // rather than guessing one.
      const details = await zstProvider.getItemDetails({ subjectId, detailPath, signal });
      const resolved = normalizeTitle(details?.subject ?? details)?.subjectId;
      resolvedSubjectId = resolved;
    }
    if (!resolvedSubjectId) throw new ApiError('BAD_REQUEST', 400, 'A title identifier is required.');
    const page = optionalInt(query.get('page')) ?? 1;
    const perPage = Math.min(optionalInt(query.get('perPage')) ?? 24, 40);
    const payload = await cached(`recommendations:${resolvedSubjectId}:${page}:${perPage}`, TTL.recommendations,
      () => zstProvider.getRecommendations({ subjectId: resolvedSubjectId, page, perPage, signal }));
    const { items, pager } = normalizePagedPayload(payload);
    return json({ items, pager }, { cache: 300 });
  },

  async media({ query, signal }) {
    const target = playbackTarget(query);
    const payload = await zstProvider.getMedia({ ...target, signal });
    return json(normalizeMediaPayload(payload), { cache: MEDIA_CACHE_SECONDS });
  },

  async stream({ query, signal }) {
    const target = playbackTarget(query);
    const height = optionalInt(query.get('quality'));
    let normalized;
    try {
      const payload = await zstProvider.getStream({ ...target, quality: height, signal });
      normalized = normalizeStreamPayload(payload);
    } catch (error) {
      if (error?.code === 'PROVIDER_ABORTED') throw error;
      normalized = { sources: [], subtitles: [], downloads: [] };
    }
    const chosen = closestSource(normalized.sources, height);
    if (!chosen) {
      // The stream route does not always answer with a resolution split, so
      // fall back to the full media package and select from real qualities.
      const payload = await zstProvider.getMedia({ ...target, signal });
      const fallback = normalizeMediaPayload(payload);
      const picked = closestSource(fallback.sources, height);
      normalized = { ...fallback, sources: picked ? [picked] : [] };
    } else {
      normalized = { ...normalized, sources: [chosen] };
    }
    if (!normalized.sources.length) throw new ApiError('PLAYBACK_UNAVAILABLE', 404, 'Playback is not available for this title.');
    return json(normalized, { cache: MEDIA_CACHE_SECONDS });
  },

  async subtitles({ query, signal }) {
    const target = playbackTarget(query);
    const payload = await zstProvider.getMedia({ ...target, signal });
    const { subtitles } = normalizeMediaPayload(payload);
    return json({ items: subtitles });
  },

  async download({ query, signal }) {
    const target = playbackTarget(query);
    const height = optionalInt(query.get('quality'));
    const payload = await zstProvider.getMedia({ ...target, signal });
    const { downloads, sources } = normalizeMediaPayload(payload);
    const available = downloads.length ? downloads : sources.map((source) => ({
      id: source.id,
      label: source.label,
      height: source.height,
      sizeBytes: source.sizeBytes,
      downloadUrl: source.url,
    }));
    if (!available.length) throw new ApiError('DOWNLOAD_UNAVAILABLE', 404, 'This title cannot be downloaded.');
    const chosen = (height ? available.find((entry) => entry.height === height) : undefined)
      || available.slice().sort((a, b) => (b.height ?? 0) - (a.height ?? 0))[0];
    return json({
      id: chosen.id,
      label: chosen.label,
      height: chosen.height ?? null,
      sizeBytes: chosen.sizeBytes ?? null,
      url: chosen.downloadUrl,
      qualities: available.map((entry) => ({ label: entry.label, height: entry.height ?? null, sizeBytes: entry.sizeBytes ?? null })),
    }, { cache: MEDIA_CACHE_SECONDS });
  },
};

export const veyraRoutes = Object.freeze(Object.keys(routes));

/**
 * @param {{ method?: string, path: string, query?: URLSearchParams, signal?: AbortSignal }} request
 * @returns {Promise<{ status: number, headers: Record<string,string>, body: unknown }>}
 */
export async function handleVeyraRequest({ method = 'GET', path, query = new URLSearchParams(), signal } = {}) {
  const clean = String(path || '').replace(/^\/+/, '');
  const name = clean.startsWith('api/veyra/') ? clean.slice('api/veyra/'.length) : clean;

  if (method.toUpperCase() !== 'GET') {
    return errorResponse(new ApiError('METHOD_NOT_ALLOWED', 405, 'Only GET is supported.'));
  }
  if (!name) {
    return json({ routes: veyraRoutes }, { cache: 0 });
  }
  const route = routes[name];
  if (!route) {
    return errorResponse(new ApiError('NOT_FOUND', 404, 'Unknown route.'));
  }

  try {
    return await route({ query, signal });
  } catch (error) {
    return errorResponse(apiErrorFrom(error));
  }
}

function errorResponse(error) {
  return {
    status: error.status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
    body: { status: false, error: { code: error.code, message: error.message } },
  };
}
