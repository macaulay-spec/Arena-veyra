import { getMovieBoxApiBaseUrl } from './client.js';

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

function contentType(record) {
  const value = record.subjectType ?? record.subject_type ?? record.type ?? record.contentType ?? record.category;
  const normalized = String(value ?? '').toLowerCase();
  if (value === 2 || normalized === '2' || /series|tv|show|anime/.test(normalized)) return 'series';
  if (value === 1 || normalized === '1' || /movie|film/.test(normalized)) return 'movie';
  return undefined;
}

export function normalizeContent(value, fallback = {}) {
  const record = asRecord(value);
  if (!record) return null;
  const providerItemId = pickText(
    record.subjectId,
    record.subject_id,
    record.providerItemId,
    record.provider_item_id,
    record.id,
    record.uid,
    record.itemId,
    fallback.providerItemId,
  );
  const detailPath = pickText(record.detailPath, record.detail_path, record.path, fallback.detailPath);
  const title = pickText(record.title, record.name, record.subjectName, record.subject_name, fallback.title);
  if (!title || (!providerItemId && !detailPath)) return null;

  const poster = mediaUrl(
    record.cover || record.coverUrl || record.cover_url || record.poster || record.posterUrl ||
    record.poster_url || record.image || record.imageUrl || record.image_url || record.thumbnail ||
    record.thumb || record.pic || fallback.poster,
  );
  const backdrop = mediaUrl(
    record.backdrop || record.backdropUrl || record.backdrop_url || record.background ||
    record.backgroundUrl || record.landscapeCover || record.landscape_cover || fallback.backdrop || poster,
  );
  const yearValue = pickText(record.year, record.releaseYear, record.release_year, record.releaseDate, record.release_date, fallback.year);
  const year = yearValue ? (yearValue.match(/\b(?:19|20)\d{2}\b/)?.[0] || yearValue) : undefined;
  const type = contentType(record) || fallback.type;
  const stableId = providerItemId || detailPath;

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
    rating: pickText(record.imdbRatingValue, record.imdb_rating_value, record.rating, record.score, fallback.rating),
    runtime: pickText(record.duration, record.runtime, record.durationText, record.duration_text, fallback.runtime),
    genres: normalizeNames(record.genres ?? record.genre ?? record.tags ?? record.genreList ?? fallback.genres),
    synopsis: pickText(record.description, record.overview, record.plot, record.summary, record.introduction, fallback.synopsis),
    maturity: pickText(record.maturity, record.ageRating, record.age_rating, record.certification, fallback.maturity),
    director: pickText(record.director, record.directorName, record.director_name, fallback.director),
    cast: normalizeNames(record.cast ?? record.casts ?? record.actors ?? record.actorList ?? fallback.cast),
    raw: record,
  };
}

const COLLECTION_KEYS = new Set([
  'items', 'list', 'results', 'subjects', 'subjectlist', 'subject_list',
  'recommendations', 'recommendlist', 'recommend_list', 'hot', 'trending',
  'movies', 'series', 'movieList', 'seriesList', 'data', 'result',
]);
const NON_CONTENT_KEYS = new Set(['cast', 'casts', 'actors', 'actorlist', 'genres', 'genre', 'tags', 'captions', 'downloads']);

function humanize(key) {
  const label = String(key || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  if (!label || label.toLowerCase() === 'data' || label.toLowerCase() === 'items' || label.toLowerCase() === 'list') return 'More to explore';
  return label.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function collectArrays(value, { maxDepth = 5 } = {}) {
  const found = [];
  const visit = (node, path, depth) => {
    if (depth > maxDepth || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      const normalized = node.map((entry) => normalizeContent(entry)).filter(Boolean);
      if (normalized.length) found.push({ key: path[path.length - 1] || 'More to explore', items: normalized });
      if (!normalized.length) node.forEach((entry) => visit(entry, path, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (NON_CONTENT_KEYS.has(key.toLowerCase())) continue;
      if (Array.isArray(child)) {
        const normalized = child.map((entry) => normalizeContent(entry)).filter(Boolean);
        if (normalized.length) found.push({ key, items: normalized });
        else child.forEach((entry) => visit(entry, [...path, key], depth + 1));
      } else if (child && typeof child === 'object') {
        const singleContent = normalizeContent(child);
        if (singleContent) found.push({ key, items: [singleContent] });
        else visit(child, [...path, key], depth + 1);
      }
    }
  };
  visit(value, [], 0);
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
  for (const [key, child] of Object.entries(record)) {
    if (COLLECTION_KEYS.has(key) && Array.isArray(child)) {
      const items = dedupeItems(child.map((entry) => normalizeContent(entry)).filter(Boolean));
      if (items.length) return items;
    }
  }
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
    const sectionKey = String(entry.key || 'More to explore');
    if (seenSections.has(sectionKey.toLowerCase())) continue;
    seenSections.add(sectionKey.toLowerCase());
    sections.push({ id: `moviebox-section:${sectionKey}`, title: humanize(sectionKey), items });
  }
  return sections;
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
  const poster = mediaUrl(record.cover || record.coverUrl || record.poster || record.thumbnail || record.image || record.thumb);
  const number = pickText(record.episodeNo, record.episode_no, record.episodeNumber, record.episode_number, record.ep, record.number);
  return {
    id: pickText(record.episodeId, record.episode_id, record.id, record.ep) || `${seasonApiValue ?? 'season'}:${number || title}`,
    title,
    number,
    description: pickText(record.description, record.overview, record.plot, record.summary),
    runtime: pickText(record.duration, record.runtime, record.durationText),
    thumbnail: poster,
    apiSeason: pickNumber(record.se, record.season, record.seasonNo, record.season_no, seasonApiValue),
    apiEpisode: pickNumber(record.ep, record.episodeIndex, record.episode_index),
    raw: record,
  };
}

function seasonRecord(value, position) {
  const record = asRecord(value);
  if (!record) return null;
  const apiValue = pickNumber(record.se, record.season, record.seasonNo, record.season_no, record.seasonNumber, record.season_number);
  const label = pickText(record.title, record.name, record.seasonName, record.season_name) || (apiValue !== undefined ? `Season ${apiValue}` : 'Season');
  const episodeList = explicitArray(record, ['episodes', 'episodeList', 'episode_list', 'children', 'items', 'list']) || [];
  const episodes = episodeList.map((episode) => episodeRecord(episode, apiValue)).filter(Boolean);
  if (!episodes.length && apiValue === undefined && !pickText(record.title, record.name, record.seasonName, record.season_name)) return null;
  return {
    id: pickText(record.seasonId, record.season_id, record.id) || `season:${apiValue ?? position}`,
    apiValue,
    label,
    episodes,
    raw: record,
  };
}

export function extractSeasons(value) {
  const root = asRecord(value) || {};
  const candidates = [
    explicitArray(root, ['seasons', 'seasonList', 'season_list']),
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
  return {
    content,
    seasons: extractSeasons(root),
    raw: root,
  };
}

export function extractSuggestions(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => typeof entry === 'string' ? entry : pickText(entry?.keyword, entry?.title, entry?.name)).filter(Boolean);
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
