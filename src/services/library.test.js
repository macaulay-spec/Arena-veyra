import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMPLETION_RATIO,
  RECENT_SEARCH_LIMIT,
  STORAGE_KEYS,
  continueWatching,
  episodeCode,
  formatRemaining,
  formatTime,
  historyId,
  isCompleted,
  isResumable,
  loadLibrary,
  loadSettings,
  nextEpisode,
  progressPercent,
  recentSearches,
  removeHistoryEntry,
  resumeTarget,
  sortedHistory,
  upsertHistory,
} from './library.js';

function memoryStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value); },
    _data: data,
  };
}

const content = { id: 'zst:subject-42', title: 'A title', type: 'series' };
const episode = { id: 'ep-4', apiSeason: 1, apiEpisode: 3, title: 'Chapter four' };

test('progress maths only reports meaningful positions', () => {
  assert.equal(progressPercent(0, 0), 0);
  assert.equal(progressPercent(300, 600), 50);
  assert.equal(progressPercent(3000, 600), 100);
  assert.equal(isCompleted(0.95, 1), true);
  assert.equal(isCompleted(COMPLETION_RATIO, 1), true);
  assert.equal(isResumable(4, 600), false);
  assert.equal(isResumable(120, 600), true);
  assert.equal(isResumable(590, 600), false);
});

test('time and episode labels are human readable', () => {
  assert.equal(formatTime(0), '0:00');
  assert.equal(formatTime(75), '1:15');
  assert.equal(formatTime(3720), '1:02:00');
  assert.equal(formatRemaining(60, 3600), '59 min left');
  assert.equal(formatRemaining(3590, 3600), '10s left');
  assert.equal(episodeCode(1, 3, { apiValue: 1 }, { apiEpisode: 3 }), 'S02:E04');
});

test('history keeps one entry per episode, newest first', () => {
  const first = upsertHistory([], { id: historyId(content, episode), content, episodeId: episode.id, position: 120, duration: 600, percent: 20, completed: false }, { now: Date.parse('2026-01-01T10:00:00Z') });
  assert.equal(first.length, 1);
  const second = upsertHistory(first, { id: historyId(content, episode), content, episodeId: episode.id, position: 240, duration: 600, percent: 40, completed: false }, { now: Date.parse('2026-01-01T11:00:00Z') });
  assert.equal(second.length, 1, 'the same episode must not be duplicated');
  assert.equal(second[0].position, 240);
  assert.equal(second[0].startedAt, first[0].startedAt);

  const other = upsertHistory(second, { id: historyId(content, { id: 'ep-5' }), content, episodeId: 'ep-5', position: 30, duration: 600, percent: 5, completed: false }, { now: Date.parse('2026-01-01T12:00:00Z') });
  assert.equal(other.length, 2);
  assert.equal(other[0].episodeId, 'ep-5', 'the most recent session leads');
  assert.deepEqual(sortedHistory(other).map((entry) => entry.episodeId), ['ep-5', 'ep-4']);
  assert.equal(removeHistoryEntry(other, other[0].id).length, 1);
});

test('continue watching ignores finished and barely started titles', () => {
  const finished = { id: 'a', content, position: 590, duration: 600, completed: true, updatedAt: '2026-01-02T00:00:00Z' };
  const barely = { id: 'b', content, position: 3, duration: 600, completed: false, updatedAt: '2026-01-03T00:00:00Z' };
  const real = { id: 'c', content, position: 180, duration: 600, completed: false, updatedAt: '2026-01-01T00:00:00Z' };
  const list = continueWatching([finished, barely, real]);
  assert.deepEqual(list.map((entry) => entry.id), ['c']);
  assert.deepEqual(resumeTarget(real), { position: 180, isResume: true });
  assert.deepEqual(resumeTarget(finished), { position: 0, isResume: false });
});

test('next episode walks the season and then the following season', () => {
  const seasons = [
    { id: 's1', episodes: [{ id: 'e1' }, { id: 'e2' }] },
    { id: 's2', episodes: [{ id: 'e3' }, { id: 'e4' }] },
  ];
  assert.equal(nextEpisode(seasons, { seasonId: 's1', episodeId: 'e1' }).episode.id, 'e2');
  assert.equal(nextEpisode(seasons, { seasonId: 's1', episodeId: 'e2' }).episode.id, 'e3');
  assert.equal(nextEpisode(seasons, { seasonId: 's2', episodeId: 'e4' }), null);
  assert.equal(nextEpisode([], { seasonId: 's1', episodeId: 'e1' }), null);
});

test('recent searches are de-duplicated and capped without inventing terms', () => {
  let list = [];
  for (let index = 0; index < RECENT_SEARCH_LIMIT + 3; index += 1) list = recentSearches(`term ${index}`, list);
  assert.equal(list.length, RECENT_SEARCH_LIMIT);
  assert.equal(list[0], `term ${RECENT_SEARCH_LIMIT + 2}`);
  const repeated = recentSearches('Term 3', list);
  assert.equal(repeated.filter((entry) => entry.toLowerCase() === 'term 3').length, 1);
  assert.equal(repeated[0], 'Term 3');
});

test('library and settings survive a restart through storage', () => {
  const storage = memoryStorage();
  storage.setItem(STORAGE_KEYS.history, JSON.stringify([{ id: 'a', content, position: 120, duration: 600 }]));
  storage.setItem(STORAGE_KEYS.searches, JSON.stringify(['Dune', 'Arrival', 42]));
  storage.setItem(STORAGE_KEYS.settings, JSON.stringify({ appearance: 'Light', preferredQuality: '720p', autoplayNext: false }));
  storage.setItem(STORAGE_KEYS.welcome, 'true');

  const library = loadLibrary(storage);
  assert.equal(library.history.length, 1);
  assert.equal(library.history[0].percent, 20, 'percent is restored from position and duration');
  assert.deepEqual(library.recent, ['Dune', 'Arrival']);
  assert.equal(library.seenWelcome, true);

  const defaults = { appearance: 'Dark', language: 'English', autoplayNext: true, subtitles: false, dataSaver: false, preferredQuality: 'Auto', notifications: true };
  const settings = loadSettings(storage, defaults);
  assert.equal(settings.preferredQuality, '720p');
  assert.equal(settings.autoplayNext, false);
  assert.equal(settings.appearance, 'Dark', 'only supported appearances are accepted');
  assert.equal(settings.language, 'English');
});

test('a corrupted store falls back to safe defaults', () => {
  const storage = memoryStorage({ [STORAGE_KEYS.history]: '{not json', [STORAGE_KEYS.searches]: '"nope"' });
  const library = loadLibrary(storage);
  assert.deepEqual(library.history, []);
  assert.deepEqual(library.recent, []);
  assert.equal(library.seenWelcome, false);
});
