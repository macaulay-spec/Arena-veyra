import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contentReference,
  readDetails,
  readDownload,
  readHome,
  readMedia,
  readPaged,
  readSuggestions,
  readTerms,
  readTitle,
  restoreReference,
  uniqueById,
} from './normalize.js';

const title = {
  id: 'zst:42',
  provider: 'zst',
  subjectId: '42',
  detailPath: 'a-title',
  type: 'series',
  title: 'A Title',
  description: 'Something happens.',
  year: '2024',
  genres: ['Drama'],
  poster: 'https://images.example/p.jpg',
  backdrop: 'https://images.example/b.jpg',
  rating: '7.5',
};

test('a usable title keeps every field a screen needs and mirrors subjectId', () => {
  const result = readTitle(title);
  assert.equal(result.id, 'zst:42');
  assert.equal(result.providerItemId, '42', 'older call sites still read providerItemId');
  assert.equal(result.type, 'series');
  assert.deepEqual(result.genres, ['Drama']);
});

test('titles that cannot be rendered are rejected rather than filled in', () => {
  assert.equal(readTitle(null), null);
  assert.equal(readTitle({ title: 'No id' }), null);
  assert.equal(readTitle({ id: 'zst:1' }), null);
  assert.equal(readTitle('nope'), null);
  assert.deepEqual(uniqueById([title, { ...title }, { id: 'zst:43', title: 'Other' }]).length, 2);
});

test('a home payload keeps only rails that carry titles', () => {
  const home = readHome({
    hero: [title],
    rails: [
      { id: 'a', title: 'Popular Series', items: [title] },
      { id: 'b', title: 'Empty', items: [] },
      { id: 'c', title: 'Broken', items: [{ title: 'no id' }] },
    ],
  });
  assert.equal(home.hero.length, 1);
  assert.deepEqual(home.rails.map((rail) => rail.title), ['Popular Series']);
});

test('a paged payload carries a usable pager even when the service omits it', () => {
  const { items, pager } = readPaged({ items: [title] });
  assert.equal(items.length, 1);
  assert.equal(pager.hasMore, false);
  assert.equal(pager.page, 1);
});

test('seasons are 1-based on the wire and 0-based for the existing label helpers', () => {
  const details = readDetails({
    title: { ...title, seasons: [{ seasonNumber: 2, episodeCount: 2, episodes: [{ episodeNumber: 3 }, { episodeNumber: 4 }] }] },
  });
  const season = details.seasons[0];
  assert.equal(season.seasonNumber, 2);
  assert.equal(season.apiValue, 1, 'the display helper adds one back');
  assert.equal(season.episodes[0].episodeNumber, 3);
  assert.equal(season.episodes[0].apiEpisode, 2);
  assert.equal(season.episodes[0].id, 's2e3');
});

test('suggestions and popular terms are plain strings with duplicates removed', () => {
  assert.deepEqual(readSuggestions({ items: [{ word: 'Stra' }, { word: 'stra' }, { word: 'Straw' }] }), [
    { word: 'Stra', kind: undefined },
    { word: 'Straw', kind: undefined },
  ]);
  assert.deepEqual(readTerms({ terms: ['A', 'A', 'B'] }), ['A', 'A', 'B']);
});

test('a media payload keeps only playable sources and real captions', () => {
  const media = readMedia({
    sources: [
      { id: '1080', label: '1080p', height: 1080, url: 'https://proxy.example/a', type: 'video' },
      { id: 'broken', label: 'x' },
    ],
    subtitles: [{ id: 'en', lang: 'en', url: 'https://proxy.example/en.srt' }, { lang: 'fr' }],
    downloads: [{ id: 'd', downloadUrl: 'https://proxy.example/dl', sizeBytes: 10 }],
    expiresAt: 1,
  });
  assert.equal(media.sources.length, 1);
  assert.equal(media.subtitles.length, 1);
  assert.equal(media.subtitles[0].language, 'en');
  assert.equal(media.downloads.length, 1);
  assert.equal(media.expiresAt, 1);
});

test('download metadata without a URL is not offered', () => {
  assert.equal(readDownload({ label: '480p' }), null);
  const download = readDownload({ label: '480p', url: 'https://proxy.example/dl', sizeBytes: 5, qualities: [{ label: '1080p', height: 1080 }] });
  assert.equal(download.url, 'https://proxy.example/dl');
  assert.equal(download.qualities[0].height, 1080);
});

test('a saved reference survives a persistence round trip', () => {
  const reference = contentReference(title);
  assert.equal(reference.provider, 'zst');
  assert.equal(reference.subjectId, '42');
  const restored = restoreReference(JSON.parse(JSON.stringify(reference)));
  assert.equal(restored.id, 'zst:42');
  assert.equal(restored.title, 'A Title');
});

test('references left over from the previous provider are rejected', () => {
  assert.equal(restoreReference({ provider: 'moviebox', id: 'moviebox:1', title: 'Old' }), null);
  assert.equal(restoreReference({ id: 'zst:1', title: 'No identifier' }), null);
  assert.equal(restoreReference(null), null);
});
