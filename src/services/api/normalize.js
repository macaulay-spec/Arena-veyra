// VEYRA model guards.
//
// The VEYRA API layer already normalizes provider data, so this module is the
// client's last line of defence rather than its mapper: it coerces types,
// drops records that cannot be displayed, and rebuilds the exact shapes the
// screens and the player expect. It never invents values.

const asRecord = (value) => (value && typeof value === 'object' && !Array.isArray(value) ? value : null);
const asArray = (value) => (Array.isArray(value) ? value : []);

function text(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function finite(value) {
  const parsed = typeof value === 'number' ? value : Number(text(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function uniqueById(items) {
  const seen = new Set();
  const out = [];
  for (const item of asArray(items)) {
    if (!item?.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

/** One catalogue title, in the shape every screen and card expects. */
export function readTitle(value) {
  const record = asRecord(value);
  if (!record) return null;
  const id = text(record.id);
  const title = text(record.title, record.name);
  if (!id || !title) return null;
  const subjectId = text(record.subjectId, record.providerItemId);
  return {
    id,
    provider: text(record.provider) || 'zst',
    subjectId,
    providerItemId: subjectId,
    detailPath: text(record.detailPath),
    type: record.type === 'series' ? 'series' : record.type === 'movie' ? 'movie' : undefined,
    title,
    description: text(record.description) || '',
    tagline: text(record.tagline),
    releaseDate: text(record.releaseDate),
    year: text(record.year),
    runtimeMinutes: finite(record.runtimeMinutes),
    genres: asArray(record.genres).map((entry) => text(entry)).filter(Boolean),
    country: text(record.country),
    rating: text(record.rating),
    ratingCount: finite(record.ratingCount),
    poster: text(record.poster),
    backdrop: text(record.backdrop),
    accent: text(record.accent),
    hasResource: Boolean(record.hasResource),
    trailerUrl: text(record.trailerUrl),
    subtitleLanguages: asArray(record.subtitleLanguages).map((entry) => text(entry)).filter(Boolean),
    isUpcoming: Boolean(record.isUpcoming),
    cast: asArray(record.cast).map(readCastMember).filter(Boolean),
    seasons: asArray(record.seasons).map(readSeason).filter(Boolean),
    episodeCount: finite(record.episodeCount),
  };
}

function readCastMember(value) {
  const record = asRecord(value);
  const name = text(record?.name);
  if (!name) return null;
  return { id: text(record.id, name), name, character: text(record.character), avatar: text(record.avatar) };
}

export function readTitles(value) {
  return uniqueById(asArray(value).map(readTitle).filter(Boolean));
}

/**
 * Season numbering is 1-based on the wire (matching the provider) and 0-based
 * in `apiValue`/`number`, which is what the existing season and episode
 * labels were written against.
 */
export function readSeason(value) {
  const record = asRecord(value);
  const seasonNumber = finite(record?.seasonNumber ?? record?.season);
  if (seasonNumber === undefined) return null;
  const episodes = asArray(record.episodes ?? record.items).map((entry) => readEpisode(entry, seasonNumber)).filter(Boolean);
  return {
    id: text(record.id) || `s${seasonNumber}`,
    seasonNumber,
    apiValue: seasonNumber - 1,
    number: seasonNumber - 1,
    label: text(record.label) || `Season ${seasonNumber}`,
    episodeCount: finite(record.episodeCount) ?? episodes.length,
    resolutions: asArray(record.resolutions).map((entry) => finite(entry)).filter((entry) => entry !== undefined),
    episodes,
  };
}

export function readEpisode(value, seasonNumber) {
  const record = asRecord(value);
  const episodeNumber = finite(record?.episodeNumber ?? record?.episode);
  if (episodeNumber === undefined) return null;
  const season = finite(record.seasonNumber ?? record.season) ?? seasonNumber ?? 1;
  return {
    id: text(record.id) || `s${season}e${episodeNumber}`,
    seasonNumber: season,
    episodeNumber,
    apiSeason: season - 1,
    apiEpisode: episodeNumber - 1,
    number: episodeNumber - 1,
    label: text(record.label) || `Episode ${episodeNumber}`,
    title: text(record.title) || `Episode ${episodeNumber}`,
    description: text(record.description),
    runtime: text(record.runtime),
    thumbnail: text(record.thumbnail),
  };
}

export function readPager(value) {
  const record = asRecord(value) || {};
  return {
    page: finite(record.page) ?? 1,
    perPage: finite(record.perPage) ?? 24,
    totalCount: finite(record.totalCount) ?? 0,
    hasMore: Boolean(record.hasMore),
    nextPage: finite(record.nextPage),
  };
}

export function readHome(payload) {
  const record = asRecord(payload) || {};
  const rails = asArray(record.rails)
    .map((rail) => {
      const entry = asRecord(rail);
      const items = readTitles(entry?.items);
      if (!items.length) return null;
      return { id: text(entry.id) || text(entry.title), title: text(entry.title) || 'More to explore', items };
    })
    .filter(Boolean);
  return { hero: readTitles(record.hero), rails };
}

export function readPaged(payload) {
  const record = asRecord(payload) || {};
  return { items: readTitles(record.items ?? record.subjectList), pager: readPager(record.pager) };
}

export function readSuggestions(payload) {
  const record = asRecord(payload) || {};
  const seen = new Set();
  const out = [];
  for (const entry of asArray(record.items ?? record.suggestions)) {
    const item = asRecord(entry);
    const word = text(item?.word ?? (typeof entry === 'string' ? entry : undefined));
    if (!word) continue;
    const key = word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ word, kind: text(item?.kind) });
  }
  return out;
}

export function readTerms(payload) {
  return asArray(asRecord(payload)?.terms).map((entry) => text(entry)).filter(Boolean);
}

export function readDetails(payload) {
  const record = asRecord(payload) || {};
  const title = readTitle(record.title);
  if (!title) return null;
  const seasons = asArray(record.title?.seasons).map(readSeason).filter(Boolean);
  return { title: { ...title, seasons }, seasons };
}

/** The normalized playback package the player consumes. */
export function readMedia(payload) {
  const record = asRecord(payload) || {};
  const sources = asArray(record.sources)
    .map((entry) => {
      const source = asRecord(entry);
      const url = text(source?.url);
      if (!url) return null;
      const height = finite(source.height);
      return {
        id: text(source.id) || `${height ?? 'x'}p`,
        label: text(source.label) || (height ? `${height}p` : 'Source'),
        height,
        url,
        fallbackUrl: text(source.fallbackUrl),
        type: text(source.type) || 'video',
        format: text(source.format),
        codec: text(source.codec),
        sizeBytes: finite(source.sizeBytes),
        durationSec: finite(source.durationSec),
        proxied: Boolean(source.proxied),
      };
    })
    .filter(Boolean);

  const subtitles = asArray(record.subtitles)
    .map((entry) => {
      const track = asRecord(entry);
      const url = text(track?.url);
      if (!url) return null;
      const lang = text(track.lang, track.language) || 'und';
      return {
        id: text(track.id) || `${lang}:${url.slice(-16)}`,
        lang,
        language: lang,
        label: text(track.label) || lang,
        url,
        sizeBytes: finite(track.sizeBytes),
        delayMs: finite(track.delayMs) || 0,
      };
    })
    .filter(Boolean);

  const downloads = asArray(record.downloads)
    .map((entry) => {
      const item = asRecord(entry);
      const url = text(item?.downloadUrl, item?.url);
      if (!url) return null;
      return {
        id: text(item.id) || url.slice(-16),
        label: text(item.label) || 'Source',
        height: finite(item.height),
        sizeBytes: finite(item.sizeBytes),
        url,
        streamUrl: text(item.streamUrl),
      };
    })
    .filter(Boolean);

  return {
    sources,
    subtitles,
    downloads,
    hasResource: Boolean(record.hasResource),
    expiresAt: finite(record.expiresAt),
  };
}

export function readDownload(payload) {
  const record = asRecord(payload) || {};
  const url = text(record.url);
  if (!url) return null;
  return {
    id: text(record.id) || url.slice(-16),
    label: text(record.label) || 'Source',
    height: finite(record.height),
    sizeBytes: finite(record.sizeBytes),
    url,
    qualities: asArray(record.qualities).map((entry) => ({
      label: text(asRecord(entry)?.label) || 'Source',
      height: finite(asRecord(entry)?.height),
      sizeBytes: finite(asRecord(entry)?.sizeBytes),
    })),
  };
}

/**
 * Compact reference stored in My List, history and Continue Watching. Only what
 * a poster row needs: the full catalogue payload is never persisted.
 */
export function contentReference(item) {
  const title = readTitle(item);
  if (!title) return null;
  return {
    id: title.id,
    provider: title.provider,
    subjectId: title.subjectId,
    providerItemId: title.subjectId,
    detailPath: title.detailPath,
    type: title.type,
    title: title.title,
    poster: title.poster,
    backdrop: title.backdrop,
    year: title.year,
    rating: title.rating,
    runtimeMinutes: title.runtimeMinutes,
    genres: title.genres,
    description: title.description,
    accent: title.accent,
    savedAt: new Date().toISOString(),
  };
}

/** Restore a stored reference, rejecting anything without a live identifier. */
export function restoreReference(value) {
  const record = asRecord(value);
  if (!record) return null;
  const subjectId = text(record.subjectId, record.providerItemId);
  const detailPath = text(record.detailPath);
  if (!subjectId && !detailPath) return null;
  const title = readTitle({ ...record, subjectId, providerItemId: subjectId });
  if (!title) return null;
  return { ...title, savedAt: text(record.savedAt) };
}
