// VEYRA local library.
//
// Everything VEYRA keeps on the device lives here: saved titles, watch
// history, playback progress, recent searches and preferences. The module is
// plain JavaScript with an injectable storage object, so the same logic runs
// in the browser, inside Capacitor, and in tests.

export const STORAGE_KEYS = Object.freeze({
  list: 'veyra-list:v2',
  history: 'veyra-history:v2',
  settings: 'veyra-settings:v2',
  searches: 'veyra-searches:v3',
  welcome: 'veyra-welcome:v1',
});

/** Ignore accidental taps: a position below this is not worth resuming. */
export const MIN_RESUME_SECONDS = 15;
/** Anything this far through is treated as finished. */
export const COMPLETION_RATIO = 0.92;
export const RECENT_SEARCH_LIMIT = 8;

export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function progressPercent(position, duration) {
  const total = Number(duration);
  const current = Number(position);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(current) || current <= 0) return 0;
  return clamp(Math.round((current / total) * 100), 0, 100);
}

export function isCompleted(position, duration) {
  const total = Number(duration);
  const current = Number(position);
  if (!Number.isFinite(total) || total <= 0) return false;
  return current / total >= COMPLETION_RATIO;
}

/** True when a stored position is worth offering as "Resume". */
export function isResumable(position, duration) {
  const current = Number(position);
  if (!Number.isFinite(current) || current < MIN_RESUME_SECONDS) return false;
  if (!Number.isFinite(Number(duration)) || Number(duration) <= 0) return true;
  return !isCompleted(current, duration);
}

export function formatTime(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

export function formatRemaining(position, duration) {
  const left = Math.max(0, Math.floor(Number(duration) || 0) - Math.floor(Number(position) || 0));
  if (!left) return '';
  if (left < 60) return `${left}s left`;
  const minutes = Math.round(left / 60);
  return minutes < 60 ? `${minutes} min left` : `${Math.floor(minutes / 60)}h ${minutes % 60}m left`;
}

/** `S01:E04` style label. Indexes are 0-based positions inside a season. */
export function episodeCode(seasonIndex, episodeIndex, season, episode) {
  const seasonNumber = Number(season?.apiValue ?? season?.number ?? seasonIndex);
  const episodeNumber = Number(episode?.apiEpisode ?? episode?.number ?? episodeIndex);
  const safeSeason = Number.isFinite(seasonNumber) ? seasonNumber + 1 : 1;
  const safeEpisode = Number.isFinite(episodeNumber) ? episodeNumber + 1 : 1;
  const pad = (value) => String(value).padStart(2, '0');
  return `S${pad(safeSeason)}:E${pad(safeEpisode)}`;
}

function episodeKey(entry) {
  if (!entry) return '';
  const explicit = entry.episodeId ?? entry.id;
  if (explicit) return String(explicit);
  const season = entry.seasonNumber ?? entry.apiSeason ?? entry.seasonId ?? '';
  const episode = entry.episodeNumber ?? entry.apiEpisode ?? '';
  return `${season}|${episode}`;
}

/** Stable history identity: a film has one entry, a series one per episode. */
export function historyId(content, episode) {
  const contentId = content?.id || content?.providerItemId;
  if (!contentId) return '';
  return episode ? `${contentId}#${episodeKey(episode)}` : `${contentId}`;
}

/**
 * Insert or update a history entry. The newest session always moves to the
 * front, and the same title/episode is never duplicated.
 */
export function upsertHistory(history, entry, { now = Date.now() } = {}) {
  const list = Array.isArray(history) ? history : [];
  if (!entry?.id || !entry.content) return list;
  const timestamp = new Date(now).toISOString();
  const previous = list.find((item) => item.id === entry.id);
  const next = {
    ...previous,
    ...entry,
    startedAt: previous?.startedAt || timestamp,
    updatedAt: timestamp,
  };
  return [next, ...list.filter((item) => item.id !== entry.id)].slice(0, 200);
}

export function updateHistoryEntry(history, id, patch) {
  const list = Array.isArray(history) ? history : [];
  return list.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
}

export function removeHistoryEntry(history, id) {
  return (Array.isArray(history) ? history : []).filter((entry) => entry.id !== id);
}

export function sortedHistory(history) {
  return [...(Array.isArray(history) ? history : [])]
    .filter(Boolean)
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/** Continue Watching only ever shows unfinished, meaningful progress. */
export function continueWatching(history) {
  return sortedHistory(history).filter((entry) => (
    entry?.content && !entry.completed && isResumable(entry.position, entry.duration)
  ));
}

export function resumeTarget(entry) {
  const position = Number(entry?.position) || 0;
  if (isResumable(position, entry?.duration)) {
    return { position, isResume: true };
  }
  return { position: 0, isResume: false };
}

/** The episode that follows `current` (wraps into the next season). */
export function nextEpisode(seasons, current) {
  const seasonList = (Array.isArray(seasons) ? seasons : []).filter((season) => season?.episodes?.length);
  if (!seasonList.length) return null;
  const seasonIndex = Math.max(0, seasonList.findIndex((season) => season.id === current?.seasonId));
  const episodes = seasonList[seasonIndex]?.episodes || [];
  const episodeIndex = episodes.findIndex((episode) => episode.id === current?.episodeId);
  if (episodeIndex >= 0 && episodeIndex < episodes.length - 1) {
    return { season: seasonList[seasonIndex], episode: episodes[episodeIndex + 1], seasonIndex, episodeIndex: episodeIndex + 1 };
  }
  const nextSeason = seasonList[seasonIndex + 1];
  if (!nextSeason?.episodes?.length) return null;
  return { season: nextSeason, episode: nextSeason.episodes[0], seasonIndex: seasonIndex + 1, episodeIndex: 0 };
}

export function recentSearches(term, current = [], limit = RECENT_SEARCH_LIMIT) {
  const value = String(term || '').trim();
  const list = (Array.isArray(current) ? current : []).map((entry) => String(entry || '').trim()).filter(Boolean);
  if (!value) return list.slice(0, limit);
  const lowered = value.toLowerCase();
  return [value, ...list.filter((entry) => entry.toLowerCase() !== lowered)].slice(0, limit);
}

function readJson(storage, key, fallback) {
  if (!storage?.getItem) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function writeJson(storage, key, value) {
  try {
    storage?.setItem?.(key, JSON.stringify(value));
    return true;
  } catch {
    // Private browsing and storage pressure both land here; the app keeps working.
    return false;
  }
}

export function loadLibrary(storage) {
  const saved = readJson(storage, STORAGE_KEYS.history, []);
  const searches = readJson(storage, STORAGE_KEYS.searches, []);
  return {
    history: Array.isArray(saved) ? saved.filter((entry) => entry?.id && entry?.content).map((entry) => ({
      ...entry,
      percent: Number.isFinite(entry.percent) ? entry.percent : progressPercent(entry.position, entry.duration),
    })) : [],
    recent: Array.isArray(searches) ? searches.filter((entry) => typeof entry === 'string').slice(0, RECENT_SEARCH_LIMIT) : [],
    seenWelcome: readJson(storage, STORAGE_KEYS.welcome, false) === true,
  };
}

export function loadSettings(storage, defaults) {
  const stored = readJson(storage, STORAGE_KEYS.settings, {});
  return {
    ...defaults,
    language: typeof stored?.language === 'string' ? stored.language : defaults.language,
    appearance: ['Dark', 'System'].includes(stored?.appearance) ? stored.appearance : defaults.appearance,
    autoplayNext: typeof stored?.autoplayNext === 'boolean' ? stored.autoplayNext : defaults.autoplayNext,
    subtitles: typeof stored?.subtitles === 'boolean' ? stored.subtitles : defaults.subtitles,
    notifications: typeof stored?.notifications === 'boolean' ? stored.notifications : defaults.notifications,
    dataSaver: typeof stored?.dataSaver === 'boolean' ? stored.dataSaver : defaults.dataSaver,
    preferredQuality: typeof stored?.preferredQuality === 'string' ? stored.preferredQuality : defaults.preferredQuality,
  };
}

export function saveSettings(storage, settings) {
  return writeJson(storage, STORAGE_KEYS.settings, settings);
}
