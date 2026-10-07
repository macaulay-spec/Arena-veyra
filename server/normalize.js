// ZST response -> VEYRA model.
//
// Every provider-shaped field stops here. Above this module the API server and
// the application only ever see VEYRA objects, so a provider change cannot leak
// into routes, screens or the player.
//
// The mappers are written against real responses captured from the deployed
// provider, and they refuse to invent data: a record without a title and a
// stable identifier is dropped rather than given a placeholder.

const SUBJECT_TYPE_MOVIE = 1;
const SUBJECT_TYPE_SERIES = 2;

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const asArray = (value) => (Array.isArray(value) ? value : []);

function text(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return undefined;
}

function integer(...values) {
  for (const value of values) {
    const raw = text(value);
    if (raw === undefined) continue;
    const parsed = Number(raw.replace(/[^\d.-]/g, ''));
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return undefined;
}

function httpUrl(...values) {
  for (const value of values) {
    const raw = typeof value === 'object' && value !== null ? text(value.url, value.src) : text(value);
    if (!raw) continue;
    if (/^https?:\/\//i.test(raw)) return raw;
    if (raw.startsWith('//')) return `https:${raw}`;
  }
  return undefined;
}

function imageUrl(...values) {
  for (const value of values) {
    const record = asRecord(value);
    const url = httpUrl(record ? record.url : value, value);
    if (url) return url;
  }
  return undefined;
}

function yearOf(releaseDate, fallback) {
  const raw = text(releaseDate, fallback);
  return raw?.match(/\b(?:19|20)\d{2}\b/)?.[0];
}

function listOfNames(value) {
  const raw = text(value);
  if (!raw) return [];
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

function subjectType(record) {
  const value = record?.subjectType ?? record?.type;
  const numeric = typeof value === 'string' ? Number(value) : value;
  if (numeric === SUBJECT_TYPE_SERIES) return 'series';
  if (numeric === SUBJECT_TYPE_MOVIE) return 'movie';
  const normalized = String(value ?? '').toLowerCase();
  if (/series|tv|show|anime/.test(normalized)) return 'series';
  if (/movie|film/.test(normalized)) return 'movie';
  return undefined;
}

/** Canonical VEYRA id for a provider subject. */
export function titleId(subjectId, detailPath) {
  return `zst:${subjectId || detailPath}`;
}

export function episodeId(subjectId, season, episode) {
  return `${titleId(subjectId)}:s${season}:e${episode}`;
}

/**
 * One catalogue entry.
 *
 * Real fields observed on the provider: subjectId, subjectType, title,
 * description, releaseDate, duration (seconds), genre (comma string),
 * cover{url}, countryName, imdbRatingValue, imdbRatingCount, subtitles
 * (comma string), hasResource, detailPath, stills{url}, trailer, postTitle.
 */
export function normalizeTitle(value) {
  const record = asRecord(value);
  if (!record) return null;
  const subject = asRecord(record.subject) || record;
  const subjectId = text(subject.subjectId, subject.subject_id, record.subjectId);
  const detailPath = text(subject.detailPath, subject.detail_path, record.detailPath);
  const title = text(subject.title, subject.name, record.title);
  if (!title || (!subjectId && !detailPath)) return null;

  const runtimeSeconds = integer(subject.duration, record.duration);
  return {
    id: titleId(subjectId, detailPath),
    provider: 'zst',
    subjectId: subjectId || undefined,
    detailPath: detailPath || undefined,
    type: subjectType(subject) || subjectType(record) || 'movie',
    title,
    description: text(subject.description, subject.overview, record.description) || '',
    tagline: text(subject.postTitle, record.postTitle),
    releaseDate: text(subject.releaseDate, subject.release_date, record.releaseDate),
    year: yearOf(subject.releaseDate, record.releaseDate),
    runtimeMinutes: runtimeSeconds ? Math.max(1, Math.round(runtimeSeconds / 60)) : undefined,
    genres: listOfNames(subject.genre ?? record.genre),
    country: text(subject.countryName, record.countryName),
    rating: text(subject.imdbRatingValue, subject.rating),
    ratingCount: integer(subject.imdbRatingCount, record.imdbRatingCount),
    poster: imageUrl(subject.cover, subject.poster, record.cover, record.poster),
    backdrop: imageUrl(subject.stills, subject.backdrop, record.stills, record.backdrop, subject.cover, record.cover),
    accent: text(subject.cover?.avgHueDark, subject.cover?.avgHueLight),
    hasResource: Boolean(subject.hasResource ?? record.hasResource),
    trailerUrl: httpUrl(subject.trailer?.videoAddress, subject.trailer?.videoAddress?.url),
    subtitleLanguages: listOfNames(subject.subtitles ?? record.subtitles),
    isUpcoming: Boolean(text(subject.appointmentDate, record.appointmentDate)),
  };
}

/** Deduplicate a normalized list by stable id, preserving provider order. */
export function dedupeTitles(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function normalizeTitleList(value) {
  return dedupeTitles(asArray(value).map(normalizeTitle).filter(Boolean));
}

/** `data.pager` as returned by /trending, /search and /recommendations. */
export function normalizePager(value, { page, perPage } = {}) {
  const record = asRecord(value) || {};
  const nextPage = integer(record.nextPage);
  return {
    page: integer(record.page, page) ?? (page ?? 1),
    perPage: integer(record.perPage, perPage) ?? perPage ?? 24,
    totalCount: integer(record.totalCount) ?? 0,
    hasMore: Boolean(record.hasMore),
    nextPage: record.hasMore && nextPage !== undefined ? nextPage : undefined,
  };
}

/** Responses that carry a subject list under either `subjectList` or `items`. */
export function normalizePagedPayload(payload) {
  const data = asRecord(payload) || {};
  const items = normalizeTitleList(data.subjectList ?? data.items ?? data.list ?? data.subjects);
  return { items, pager: normalizePager(data.pager, { page: payload?.page, perPage: payload?.perPage }) };
}

export const HOME_SECTION_TYPES = new Set(['SUBJECTS_MOVIE', 'PLAY_LIST', 'APPOINTMENT_LIST']);

/**
 * The provider homepage is a list of positioned operations. Only the ones that
 * actually carry playable titles become rails, and technical or promotional
 * section names are not passed through to viewers.
 */
export function normalizeHomepage(payload) {
  const data = asRecord(payload) || {};
  const operations = asArray(data.operatingList);
  const hero = [];
  const rails = [];
  const usedTitles = new Set();

  const bannerOp = operations.find((op) => asRecord(op)?.type === 'BANNER' && asArray(asRecord(op)?.banner?.items).length);
  for (const entry of asArray(bannerOp?.banner?.items)) {
    const item = normalizeTitle(asRecord(entry)?.subject || entry) || normalizeTitle(entry);
    if (item) hero.push(item);
  }

  for (const operation of operations) {
    const op = asRecord(operation);
    if (!op || !HOME_SECTION_TYPES.has(String(op.type))) continue;
    const items = normalizeTitleList(op.subjects ?? op.banner?.items ?? op.playList);
    if (!items.length) continue;
    const label = text(op.title);
    // Promotional and catalogue-machinery names stay out of the interface.
    if (!label || /vip|wwe|wrestl|channel|shorts|skit|karaoke|song|music video/i.test(label)) continue;
    const key = label.toLowerCase();
    if (usedTitles.has(key)) continue;
    usedTitles.add(key);
    rails.push({ id: `zst-rail:${key.replace(/[^a-z0-9]+/g, '-')}`, title: label, items });
  }

  return { hero: dedupeTitles(hero), rails };
}

export function normalizeHotPayload(payload) {
  const data = asRecord(payload) || {};
  const movies = normalizeTitleList(data.movie ?? data.movies);
  const series = normalizeTitleList(data.tv ?? data.series ?? data.tvSeries);
  return { movies, series };
}

export function normalizePopularSearches(payload) {
  const data = asRecord(payload) || {};
  const entries = asArray(data.everyoneSearch ?? data.items ?? data.keywords);
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const term = text(typeof entry === 'string' ? entry : entry?.title ?? entry?.word ?? entry?.keyword);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/** `/search-suggestion` answers with `data.items[].word`. */
export function normalizeSuggestions(payload) {
  const data = asRecord(payload) || {};
  const entries = asArray(data.items ?? data.suggestions ?? data.keywords);
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    const word = text(typeof entry === 'string' ? entry : entry?.word ?? entry?.title ?? entry?.keyword);
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ word, kind: integer(entry?.type) === 2 ? 'series' : integer(entry?.type) === 1 ? 'movie' : 'title' });
  }
  return out;
}

export function normalizeCast(payload) {
  return asArray(asRecord(payload)?.stars ?? asRecord(payload)?.staffList ?? payload)
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const name = text(record.name, record.staffName);
      if (!name) return null;
      return {
        id: text(record.staffId, record.detailPath, name),
        name,
        character: text(record.character, record.role),
        avatar: imageUrl(record.avatarUrl, record.avatar),
      };
    })
    .filter(Boolean);
}

/**
 * `data.resource.seasons[]` carries `{ se, maxEp, resolutions:[{resolution, epNum}] }`.
 * The provider does not expose per-episode titles, so episodes are derived from
 * the season's real episode count instead of a hardcoded number.
 */
export function normalizeSeasons(payload) {
  const resource = asRecord(asRecord(payload)?.resource) || {};
  const seasons = asArray(resource.seasons);
  return seasons
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      const season = integer(record.se, record.season, record.seasonNumber);
      const episodeCount = integer(record.maxEp, record.episodeCount, record.totalEp);
      if (season === undefined || !episodeCount) return null;
      const resolutions = asArray(record.resolutions)
        .map((res) => integer(asRecord(res)?.resolution))
        .filter((height) => height !== undefined);
      return {
        season,
        label: `Season ${season}`,
        episodeCount,
        // The provider publishes a count, not a list, so the episodes are
        // derived from the real number instead of being hardcoded.
        episodes: Array.from({ length: episodeCount }, (_, index) => ({
          id: `s${season}e${index + 1}`,
          season,
          episode: index + 1,
          label: `Episode ${index + 1}`,
        })),
        resolutions: [...new Set(resolutions)].sort((a, b) => b - a),
        episodeResolutions: asArray(record.resolutions).map((res) => ({
          height: integer(asRecord(res)?.resolution),
          episodeCount: integer(asRecord(res)?.epNum) ?? 0,
        })).filter((entry) => entry.height !== undefined),
        uploader: text(record.uploadBy),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.season - b.season);
}

export function episodesFor(seasons, seasonNumber) {
  const season = seasons?.find((entry) => entry.season === seasonNumber);
  if (!season) return [];
  return Array.from({ length: season.episodeCount }, (_, index) => ({
    episode: index + 1,
    season: season.season,
    label: `Episode ${index + 1}`,
  }));
}

export function normalizeDetails(payload, { subjectId } = {}) {
  const data = asRecord(payload) || {};
  const subject = data.subject ?? data.item ?? data;
  const title = normalizeTitle(subject);
  if (!title) return null;
  const seasons = normalizeSeasons(data);
  return {
    title: {
      ...title,
      cast: normalizeCast(data),
      seasons,
      episodeCount: seasons.reduce((total, season) => total + season.episodeCount, 0),
    },
    subjectId: text(subjectId, title.subjectId),
  };
}

/** Pull a unix expiry stamp out of a provider URL, including nested proxied ones. */
export function expiresAtFromUrl(...values) {
  for (const value of values) {
    const raw = text(value);
    if (!raw) continue;
    const direct = /[?&]t=(\d{10,13})/.exec(raw);
    if (direct) return Number(direct[1]) * 1000;
    try {
      const nested = new URL(raw).searchParams.get('url');
      if (nested) {
        const inner = expiresAtFromUrl(nested);
        if (inner) return inner;
      }
    } catch {
      /* not a URL */
    }
  }
  return undefined;
}

function streamHeight(record, fallback) {
  return integer(record?.resolutions, record?.resolution, fallback);
}

function streamType(record, url) {
  const kind = String(text(record?.format, record?.codecName) ?? '').toLowerCase();
  if (kind.includes('hls') || /\.m3u8(\?|$)/i.test(url || '')) return 'hls';
  if (kind.includes('dash') || /\.mpd(\?|$)/i.test(url || '')) return 'dash';
  return 'video';
}

/**
 * The playback package.
 *
 * `/api/media` answers with three sibling blocks (`stream`, `downloads`,
 * `subtitles`), each wrapping its own `{ code, message, data }`. The stream
 * block holds direct CDN URLs, the downloads block holds the same resources
 * through the authorized proxy with an explicit resolution and size, and the
 * captions live beside them.
 */
export function normalizeMediaPayload(payload) {
  const data = asRecord(payload) || {};
  const streamBlock = asRecord(data.stream?.data) || asRecord(data.stream) || {};
  const downloadBlock = asRecord(data.downloads?.data) || asRecord(data.downloads) || {};
  const subtitleBlock = asRecord(data.subtitles?.data) || asRecord(data.subtitles) || {};

  const downloads = asArray(downloadBlock.downloads ?? streamBlock.downloads).map((entry) => {
    const record = asRecord(entry);
    if (!record) return null;
    const height = integer(record.resolution);
    const streamUrl = httpUrl(record.streamUrl, record.url);
    const downloadUrl = httpUrl(record.downloadUrl, record.url);
    if (!streamUrl && !downloadUrl) return null;
    return {
      id: text(record.id, height ? `${height}p` : undefined) || `download-${height ?? 'x'}`,
      label: height ? `${height}p` : 'Source',
      height,
      sizeBytes: integer(record.size),
      streamUrl,
      downloadUrl,
    };
  }).filter(Boolean);

  const isHls = (record) => streamType(record, text(record?.url)) === 'hls';
  const directStreams = [
    ...asArray(streamBlock.streams),
    ...asArray(streamBlock.hls).map((entry) => ({ ...asRecord(entry), format: 'HLS' })),
    ...asArray(streamBlock.dash).map((entry) => ({ ...asRecord(entry), format: 'DASH' })),
  ].map((entry) => {
    const record = asRecord(entry);
    if (!record) return null;
    const url = httpUrl(record.url, record.streamUrl);
    if (!url) return null;
    const height = streamHeight(record);
    const proxied = downloads.find((candidate) => candidate.height === height && candidate.streamUrl);
    return {
      id: text(record.id, height ? `${height}p` : undefined) || `source-${height ?? 'x'}`,
      label: height ? `${height}p` : text(record.format) || 'Source',
      height,
      // Playback prefers the authorized proxy because it carries the correct
      // referer and CORS headers for the WebView; the direct CDN URL is kept
      // as the fallback the player can retry with.
      url: proxied?.streamUrl || url,
      fallbackUrl: proxied ? url : undefined,
      type: isHls(record) ? 'hls' : streamType(record, url),
      format: text(record.format),
      codec: text(record.codecName),
      sizeBytes: integer(record.size) ?? proxied?.sizeBytes,
      durationSec: integer(record.duration),
      proxied: Boolean(proxied?.streamUrl),
    };
  }).filter(Boolean);

  // Some titles only publish through the downloads block.
  for (const download of downloads) {
    if (directStreams.some((source) => source.height === download.height)) continue;
    const freeHeight = download.height;
    directStreams.push({
      id: download.id,
      label: download.label,
      height: freeHeight,
      url: download.streamUrl || download.downloadUrl,
      fallbackUrl: download.downloadUrl,
      type: 'video',
      format: 'MP4',
      codec: undefined,
      sizeBytes: download.sizeBytes,
      durationSec: undefined,
      proxied: true,
    });
  }

  const seenSources = new Set();
  const sources = directStreams
    .filter((source) => {
      const key = `${source.height ?? 'x'}:${source.url}`;
      if (seenSources.has(key)) return false;
      seenSources.add(key);
      return true;
    })
    .sort((a, b) => (b.height ?? 0) - (a.height ?? 0));

  const captionEntries = asArray(subtitleBlock.captions).length
    ? asArray(subtitleBlock.captions)
    : asArray(downloadBlock.captions);
  const subtitles = captionEntries.map((entry) => {
    const record = asRecord(entry);
    if (!record) return null;
    const url = httpUrl(record.url);
    if (!url) return null;
    const lang = text(record.lan, record.language, record.lang);
    return {
      id: text(record.id, lang) || url,
      lang: lang || 'und',
      label: text(record.lanName, record.label, lang) || 'Subtitles',
      url,
      sizeBytes: integer(record.size),
      delayMs: integer(record.delay) || 0,
    };
  }).filter(Boolean);

  return {
    sources,
    subtitles,
    downloads: downloads.filter((entry) => entry.downloadUrl),
    hasResource: Boolean(streamBlock.hasResource ?? downloadBlock.hasResource ?? sources.length),
    limited: Boolean(streamBlock.limited ?? downloadBlock.limited),
    expiresAt: expiresAtFromUrl(...sources.map((source) => source.url), ...sources.map((source) => source.fallbackUrl)),
  };
}

/** `/api/stream` wraps the same stream block directly under `data`. */
export function normalizeStreamPayload(payload) {
  const data = asRecord(payload) || {};
  return normalizeMediaPayload({ stream: { data } });
}
