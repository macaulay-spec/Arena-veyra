import { buildApiProxyUrl, getMovieBoxApiBaseUrl, isApiProxyUrl, unwrapApiProxyUrl } from './client.js';

const text = (value) => {
  if (typeof value === 'string' || typeof value === 'number') {
    const result = String(value).trim();
    return result || undefined;
  }
  return undefined;
};

function pickText(...values) {
  for (const value of values) {
    const result = text(value);
    if (result) return result;
  }
  return undefined;
}

function pickNumber(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  }
  return undefined;
}

function pickBoolean(...values) {
  for (const value of values) {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
  }
  return undefined;
}

function asRecord(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function mediaUrl(value) {
  const source = text(value);
  if (!source) return undefined;
  if (/^(https?:)?\/\//i.test(source) || source.startsWith('data:')) return source.startsWith('//') ? `https:${source}` : source;
  const base = getMovieBoxApiBaseUrl();
  if (!base) return undefined;
  try {
    const parsed = new URL(source, `${base}/`);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeNames(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      const object = asRecord(entry);
      return object ? pickText(object.name, object.title, object.genreName, object.castName) : undefined;
    }).filter(Boolean);
  }
  if (typeof value === 'string') return value.split(/[|,;/]/).map((entry) => entry.trim()).filter(Boolean);
  return [];
}

function imageUrl(...values) {
  for (const value of values) {
    const object = asRecord(value);
    const source = text(value) || (object && pickText(object.url, object.src, object.imageUrl, object.image_url, object.originalUrl));
    const normalized = mediaUrl(source);
    if (normalized) return normalized;
  }
  return undefined;
}

function contentType(record) {
  const subject = asRecord(record.subject) || {};
  const value = record.subjectType ?? record.subject_type ?? subject.subjectType ?? subject.subject_type ?? record.type ?? record.contentType ?? record.category;
  const normalized = String(value ?? '').toLowerCase();
  if (value === 2 || normalized === '2' || /series|tv|show|anime/.test(normalized)) return 'series';
  if (value === 1 || normalized === '1' || /movie|film/.test(normalized)) return 'movie';
  return undefined;
}

/** Render a provider duration (seconds) as a human runtime. */
function humanRuntime(value) {
  const seconds = pickNumber(value);
  if (seconds === undefined || seconds <= 0) return pickText(value);
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** Split the provider's `stars`/`staffList` array into director, writers and cast. */
function splitStaff(record) {
  const list = [record.stars, record.staffList, record.staff_list].find(Array.isArray) || [];
  const director = [];
  const cast = [];
  const seenCast = new Set();
  for (const entry of list) {
    const staff = asRecord(entry);
    if (!staff) continue;
    const name = pickText(staff.name, staff.staffName, staff.staff_name);
    if (!name) continue;
    const type = pickNumber(staff.staffType, staff.staff_type);
    if (type === 2) {
      if (!director.includes(name)) director.push(name);
    } else if (type === 3) {
      continue;
    } else if (!seenCast.has(name)) {
      seenCast.add(name);
      cast.push(name);
    }
  }
  return { director, cast };
}

export function normalizeContent(value, fallback = {}) {
  const record = asRecord(value);
  if (!record) return null;
  const subject = asRecord(record.subject) || {};
  const providerItemId = pickText(
    record.subjectId,
    record.subject_id,
    subject.subjectId,
    subject.subject_id,
    record.providerItemId,
    record.provider_item_id,
    record.id,
    record.uid,
    record.itemId,
    fallback.providerItemId,
  );
  const detailPath = pickText(record.detailPath, record.detail_path, subject.detailPath, subject.detail_path, record.path, fallback.detailPath);
  const title = pickText(record.title, record.name, record.subjectName, record.subject_name, subject.title, subject.name, fallback.title);
  if (!title || (!providerItemId && !detailPath)) return null;

  const poster = imageUrl(
    record.poster, record.posterUrl, record.poster_url, record.cover, record.coverUrl, record.cover_url,
    subject.poster, subject.cover, record.image, record.thumbnail, record.thumb, record.pic, fallback.poster,
  );
  const backdrop = imageUrl(
    record.backdrop, record.backdropUrl, record.backdrop_url, record.background, record.backgroundUrl,
    record.landscapeCover, record.landscape_cover, record.stills, subject.stills, subject.image,
    record.image, subject.cover, fallback.backdrop, poster,
  );
  const yearValue = pickText(record.year, record.releaseYear, record.release_year, record.releaseDate, record.release_date, subject.year, subject.releaseDate, fallback.year);
  const year = yearValue ? (yearValue.match(/\b(?:19|20)\d{2}\b/)?.[0] || yearValue) : undefined;
  const type = contentType(record) || fallback.type;
  const stableId = providerItemId || detailPath;

  const staff = splitStaff(record);
  const director = pickText(
    record.director, record.directorName, record.director_name, subject.director,
    staff.director[0], fallback.director,
  );
  const castNames = normalizeNames(record.cast ?? record.casts ?? record.actors ?? record.actorList ?? subject.cast ?? subject.actors ?? fallback.cast);
  const cast = (castNames.length ? castNames : staff.cast).slice(0, 24);

  return {
    id: `moviebox:${stableId}`,
    provider: 'moviebox',
    providerItemId: providerItemId || undefined,
    detailPath,
    title,
    type,
    poster,
    backdrop,
    year,
    rating: pickText(record.imdbRatingValue, record.imdb_rating_value, record.rating, record.score, subject.imdbRatingValue, subject.rating, fallback.rating),
    runtime: humanRuntime(pickNumber(record.duration, subject.duration, fallback.durationSeconds) ?? pickText(record.runtime, record.durationText, record.duration_text, subject.runtime, fallback.runtime)),
    genres: normalizeNames(record.genres ?? record.genre ?? record.tags ?? record.genreList ?? subject.genres ?? subject.genre ?? fallback.genres),
    synopsis: pickText(record.description, record.overview, record.plot, record.summary, record.introduction, subject.description, subject.overview, subject.plot, fallback.synopsis),
    maturity: pickText(record.maturity, record.ageRating, record.age_rating, record.certification, subject.maturity, subject.ageRating, fallback.maturity),
    director,
    cast,
    hasResource: pickBoolean(record.hasResource, subject.hasResource, fallback.hasResource),
    durationSeconds: pickNumber(record.duration, subject.duration, fallback.durationSeconds),
    raw: record,
  };
}

const COLLECTION_KEYS = new Set([
  'items', 'list', 'results', 'subjects', 'subjectlist', 'subject_list',
  'recommendations', 'recommendlist', 'recommend_list', 'hot', 'trending',
  'movies', 'series', 'movie', 'tv', 'movielist', 'serieslist', 'data', 'result',
]);
const NON_CONTENT_KEYS = new Set(['cast', 'casts', 'actors', 'actorlist', 'genres', 'genre', 'tags', 'captions', 'downloads', 'seasons', 'seasonlist', 'season_list', 'episodes', 'episodelist', 'episode_list', 'stars', 'stafflist']);

function humanize(key) {
  const label = String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  if (!label || label.toLowerCase() === 'data' || label.toLowerCase() === 'items' || label.toLowerCase() === 'list') return 'More to explore';
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collectArrays(value, { maxDepth = 5 } = {}) {
  const found = [];
  const visit = (node, path, depth, inheritedTitle) => {
    if (depth > maxDepth || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      const normalized = node.map((entry) => normalizeContent(entry)).filter(Boolean);
      if (normalized.length) found.push({ key: path[path.length - 1] || 'More to explore', title: inheritedTitle, items: normalized });
      if (!normalized.length) node.forEach((entry) => visit(entry, path, depth + 1, inheritedTitle));
      return;
    }
    const sectionTitle = pickText(node.title, node.sectionTitle, node.section_name, node.categoryName, inheritedTitle);
    for (const [key, child] of Object.entries(node)) {
      if (NON_CONTENT_KEYS.has(key.toLowerCase())) continue;
      if (Array.isArray(child)) {
        const normalized = child.map((entry) => normalizeContent(entry)).filter(Boolean);
        if (normalized.length) found.push({ key, title: sectionTitle, items: normalized });
        else child.forEach((entry) => visit(entry, [...path, key], depth + 1, sectionTitle));
      } else if (child && typeof child === 'object') {
        const singleContent = normalizeContent(child);
        if (singleContent) found.push({ key, title: sectionTitle, items: [singleContent] });
        else visit(child, [...path, key], depth + 1, sectionTitle);
      }
    }
  };
  visit(value, [], 0, undefined);
  return found;
}

function dedupeItems(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function extractContentList(value) {
  if (Array.isArray(value)) return dedupeItems(value.map((entry) => normalizeContent(entry)).filter(Boolean));
  const record = asRecord(value);
  if (!record) return [];
  const singleContent = normalizeContent(record);
  if (singleContent) return [singleContent];
  const preferredItems = [];
  for (const [key, child] of Object.entries(record)) {
    if (COLLECTION_KEYS.has(key.toLowerCase()) && Array.isArray(child)) {
      preferredItems.push(...child.map((entry) => normalizeContent(entry)).filter(Boolean));
    }
  }
  if (preferredItems.length) return dedupeItems(preferredItems);
  const arrays = collectArrays(record);
  return dedupeItems(arrays.flatMap((entry) => entry.items));
}

export function extractContentSections(value) {
  const rootItem = normalizeContent(value);
  if (rootItem) return [{ id: 'moviebox-section:featured', title: 'Featured from your catalog', items: [rootItem] }];
  const arrays = collectArrays(value);
  const sections = [];
  const seenSections = new Set();
  for (const entry of arrays) {
    const items = dedupeItems(entry.items);
    if (!items.length) continue;
    const sectionKey = String(entry.title || entry.key || 'More to explore');
    const title = humanize(sectionKey);
    if (seenSections.has(title.toLowerCase())) continue;
    seenSections.add(title.toLowerCase());
    sections.push({ id: `moviebox-section:${sectionKey}`, title, items });
  }
  return sections;
}

/**
 * The provider's pager envelope (search / trending): { hasMore, nextPage, page, perPage, totalCount }.
 * Returned as-is so screens can drive "load more" from real server state.
 */
export function extractPager(value) {
  const record = asRecord(value) || {};
  const pager = asRecord(record.pager) || asRecord(record.pageInfo) || {};
  const hasMore = pickBoolean(pager.hasMore, record.hasMore);
  const nextPage = pickNumber(pager.nextPage, record.nextPage);
  return { hasMore: Boolean(hasMore), nextPage, totalCount: pickNumber(pager.totalCount, record.totalCount) };
}

export function extractSearchPage(value) {
  return { items: extractContentList(value), pager: extractPager(value) };
}

function explicitArray(object, keys) {
  for (const key of keys) {
    if (Array.isArray(object?.[key])) return object[key];
  }
  return undefined;
}

function episodeRecord(value, seasonApiValue) {
  const record = asRecord(value);
  if (!record) return null;
  const title = pickText(record.title, record.name, record.episodeName, record.episode_name);
  if (!title) return null;
  const poster = imageUrl(record.cover, record.coverUrl, record.poster, record.thumbnail, record.image, record.thumb);
  const number = pickNumber(record.episodeNo, record.episode_no, record.episodeNumber, record.episode_number, record.ep, record.number);
  const season = pickNumber(record.se, record.season, record.seasonNo, record.season_no, seasonApiValue);
  return {
    id: pickText(record.episodeId, record.episode_id, record.id, record.ep) || `${season ?? 'season'}:${number ?? title}`,
    title,
    number,
    episodeNo: number,
    season,
    description: pickText(record.description, record.overview, record.plot, record.summary),
    runtime: pickText(record.duration, record.runtime, record.durationText),
    thumbnail: poster,
    apiSeason: season,
    apiEpisode: pickNumber(record.ep, record.episodeIndex, record.episode_index) ?? number,
    raw: record,
  };
}

/** Episode numbers present in `allEp` (comma-separated), preserving any gaps. */
function episodesFromAllEp(allEp) {
  const matches = String(allEp).match(/\d+/g);
  if (!matches) return [];
  return [...new Set(matches.map(Number))].filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b);
}

function synthesizeEpisodes(seasonApiValue, maxEp, allEp) {
  const listed = typeof allEp === 'string' && allEp.trim() ? episodesFromAllEp(allEp) : [];
  // Never invent 1..maxEp when an explicit (possibly gapped) episode list exists.
  const numbers = listed.length ? listed : (maxEp > 0 ? Array.from({ length: Math.min(maxEp, 2000) }, (_, index) => index + 1) : []);
  return numbers.map((number) => ({
    id: `${seasonApiValue ?? 'season'}:${number}`,
    title: `Episode ${number}`,
    number,
    episodeNo: number,
    season: seasonApiValue,
    apiSeason: seasonApiValue,
    apiEpisode: number,
    description: undefined,
    runtime: undefined,
    thumbnail: undefined,
    synthesized: true,
  }));
}

function seasonRecord(value, position) {
  const record = asRecord(value);
  if (!record) return null;
  const apiValue = pickNumber(record.se, record.season, record.seasonNo, record.season_no, record.seasonNumber, record.season_number);
  const label = pickText(record.title, record.name, record.seasonName, record.season_name) || (apiValue !== undefined ? `Season ${apiValue}` : 'Season');
  const episodeList = explicitArray(record, ['episodes', 'episodeList', 'episode_list', 'children', 'items', 'list']) || [];
  const explicit = episodeList.map((episode) => episodeRecord(episode, apiValue)).filter(Boolean);
  const maxEp = pickNumber(record.maxEp, record.max_ep, record.episodeCount, record.episode_count) ?? 0;
  const allEp = pickText(record.allEp, record.all_ep) ?? '';
  const episodes = explicit.length ? explicit : synthesizeEpisodes(apiValue, maxEp, allEp);
  if (!episodes.length && apiValue === undefined && !pickText(record.title, record.name, record.seasonName, record.season_name)) return null;
  return {
    id: pickText(record.seasonId, record.season_id, record.id) || `season:${apiValue ?? position}`,
    apiValue,
    label,
    maxEp,
    allEp,
    // Per-season quality hints from the provider: [{ resolution, epNum }].
    resolutions: (Array.isArray(record.resolutions) ? record.resolutions : [])
      .map((entry) => pickNumber(asRecord(entry)?.resolution))
      .filter((value) => value !== undefined),
    episodes,
    episodeCount: episodes.length,
    raw: record,
  };
}

export function extractSeasons(value) {
  const root = asRecord(value) || {};
  const resource = asRecord(root.resource) || {};
  const candidates = [
    explicitArray(root, ['seasons', 'seasonList', 'season_list']),
    explicitArray(resource, ['seasons', 'seasonList', 'season_list']),
    explicitArray(root.subject, ['seasons', 'seasonList', 'season_list']),
    explicitArray(root.tvInfo, ['seasons', 'seasonList', 'season_list']),
    explicitArray(root.tv_info, ['seasons', 'seasonList', 'season_list']),
  ].find(Array.isArray);
  if (!candidates) return [];
  return candidates.map((season, index) => seasonRecord(season, index)).filter(Boolean);
}

export function normalizeDetail(value, fallback) {
  const root = asRecord(value) || {};
  const subject = asRecord(root.subject) || asRecord(root.item) || asRecord(root.detail) || root;
  const content = normalizeContent(subject, fallback) || fallback;
  const seasons = extractSeasons(root);
  return {
    content: content ? { ...content, type: content.type || (seasons.length ? 'series' : content.type) } : content,
    seasons,
    isSeries: pickBoolean(root.isSeries, root.is_series) ?? seasons.length > 0,
    raw: root,
  };
}

/**
 * Normalize a /api/media payload.
 *
 * Shape: data.downloads.data.downloads[] with { resolution, size, url, streamUrl, downloadUrl }
 *        data.downloads.data.captions[]  with { lan, lanName, url, size }
 *        data.stream.data.streams[]      with { format: 'MP4', url, resolutions, duration }
 *        hls / dash arrays are empty — this provider serves progressive MP4 only.
 *
 * Every returned quality carries a proxied `streamUrl`; a raw CDN url is never
 * handed to the player (those hosts answer 429 without the provider proxy).
 * Qualities with no usable stream are dropped.
 */
export function normalizeMedia(payload) {
  const root = asRecord(payload) || {};
  const envelopeData = asRecord(root.data) || {};
  const container = asRecord(root.downloads) ? root : (asRecord(envelopeData.downloads) ? envelopeData : root);
  const downloadsNode = asRecord(container.downloads) || {};
  const streamNode = asRecord(container.stream) || asRecord(envelopeData.stream) || {};
  const downloadsData = asRecord(downloadsNode.data) || {};
  const streamData = asRecord(streamNode.data) || {};

  const downloadEntries = Array.isArray(downloadsData.downloads) ? downloadsData.downloads
    : Array.isArray(downloadsNode.downloads) ? downloadsNode.downloads
      : Array.isArray(container.downloads) ? container.downloads
        : [];

  const qualities = [];
  const seenResolutions = new Set();
  for (const entry of downloadEntries) {
    const record = asRecord(entry);
    if (!record) continue;
    const resolution = pickNumber(record.resolution, record.resolutions, record.quality);
    const provided = mediaUrl(record.streamUrl);
    const derived = provided ? undefined : buildApiProxyUrl(pickText(record.url, record.stream));
    const streamUrl = provided || derived;
    if (!streamUrl) continue; // no proxied stream => the player cannot use it
    const key = resolution ?? streamUrl;
    if (seenResolutions.has(key)) continue;
    seenResolutions.add(key);
    qualities.push({
      resolution,
      label: resolution ? `${resolution}p` : 'Auto',
      sizeBytes: pickNumber(record.size, record.sizeBytes, record.size_bytes),
      streamUrl,
      downloadUrl: mediaUrl(record.downloadUrl),
    });
  }
  qualities.sort((a, b) => (b.resolution || 0) - (a.resolution || 0));

  const captionEntries = Array.isArray(downloadsData.captions) ? downloadsData.captions
    : Array.isArray(downloadsNode.captions) ? downloadsNode.captions
      : [];
  const captions = [];
  const seenLanguages = new Set();
  for (const entry of captionEntries) {
    const record = asRecord(entry);
    if (!record) continue;
    const raw = pickText(record.url);
    if (!raw) continue;
    // Caption links sometimes arrive already wrapped by the provider (often via
    // the proxy-download route, which is under maintenance). Rebuild them on the
    // regular /api/proxy route so subtitles do not hang.
    const inner = isApiProxyUrl(raw) ? unwrapApiProxyUrl(raw) : raw;
    const url = buildApiProxyUrl(inner) || mediaUrl(inner);
    if (!url) continue;
    const lang = pickText(record.lan, record.lang, record.language) || 'und';
    const langName = pickText(record.lanName, record.langName, record.languageName, record.name) || lang;
    const key = `${lang}:${langName}`;
    if (seenLanguages.has(key)) continue;
    seenLanguages.add(key);
    captions.push({ lang, langName, language: langName, url });
  }
  captions.sort((a, b) => a.language.localeCompare(b.language));

  const streams = Array.isArray(streamData.streams) ? streamData.streams : [];
  const duration = streams.reduce((max, entry) => {
    const value = pickNumber(asRecord(entry)?.duration);
    return value && value > max ? value : max;
  }, 0);

  const hasResource = pickBoolean(
    downloadsData.hasResource,
    streamData.hasResource,
    container.hasResource,
    envelopeData.hasResource,
  ) ?? qualities.length > 0;

  return {
    hasResource: Boolean(hasResource) && qualities.length > 0,
    qualities,
    captions,
    duration: duration || undefined,
  };
}

/** The provider home page occasionally carries an operator notice/maintenance banner. */
export function extractNotice(value) {
  const root = asRecord(value) || {};
  const data = asRecord(root.data) || root;
  const candidates = [data.notice, data.maintenance, data.announcement, data.banner, root.notice, root.message];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const message = candidate.trim();
      if (message && !/^ok$/i.test(message)) return message;
    }
    const record = asRecord(candidate);
    const message = record && pickText(record.message, record.description, record.content, record.title, record.text);
    if (message) return message;
  }
  return '';
}

export function extractSuggestions(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => typeof entry === 'string' ? entry : pickText(entry?.keyword, entry?.word, entry?.title, entry?.name)).filter(Boolean);
  }
  const record = asRecord(value);
  if (!record) return [];
  const preferred = explicitArray(record, ['items', 'suggestions', 'keywords', 'list', 'results']);
  if (preferred) return extractSuggestions(preferred);
  for (const child of Object.values(record)) {
    if (Array.isArray(child)) {
      const suggestions = extractSuggestions(child);
      if (suggestions.length) return suggestions;
    }
  }
  return [];
}

export function contentReference(item) {
  if (!item) return null;
  return {
    id: item.id,
    provider: item.provider || 'moviebox',
    providerItemId: item.providerItemId,
    detailPath: item.detailPath,
    type: item.type,
    title: item.title,
    poster: item.poster,
    backdrop: item.backdrop,
    year: item.year,
    rating: item.rating,
    runtime: item.runtime,
    genres: item.genres || [],
    synopsis: item.synopsis,
    hasResource: item.hasResource,
    savedAt: new Date().toISOString(),
  };
}

export function normalizeSavedReference(value) {
  const record = asRecord(value);
  if (record?.provider !== 'moviebox' || !pickText(record.providerItemId, record.provider_item_id, record.detailPath, record.detail_path)) return null;
  const content = normalizeContent({ ...record, subjectId: record.providerItemId || record.provider_item_id, id: undefined });
  if (!content) return null;
  return { ...contentReference(content), savedAt: pickText(record.savedAt) };
}

/** Format seconds as m:ss / h:mm:ss for the player timeline. */
export function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const padded = String(secs).padStart(2, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${padded}` : `${minutes}:${padded}`;
}
