import test from 'node:test';
import assert from 'node:assert/strict';
import { movieBoxClient, MovieBoxServiceError } from './client.js';
import {
  contentReference,
  extractContentList,
  extractContentSections,
  extractSeasons,
  extractSuggestions,
  normalizeContent,
  normalizeSavedReference,
} from './normalize.js';

const apiTitle = {
  subjectId: 'subject-42',
  subjectType: 2,
  detailPath: 'show/example',
  title: 'Catalog title',
  cover: 'https://images.example/cover.jpg',
  releaseDate: '2024-03-01',
  genre: [{ name: 'Drama' }, { name: 'Mystery' }],
};

test('normalizes an API subject and retains provider identifiers', () => {
  const result = normalizeContent(apiTitle);
  assert.equal(result.id, 'moviebox:subject-42');
  assert.equal(result.providerItemId, 'subject-42');
  assert.equal(result.detailPath, 'show/example');
  assert.equal(result.type, 'series');
  assert.equal(result.title, 'Catalog title');
  assert.equal(result.poster, apiTitle.cover);
  assert.equal(result.year, '2024');
  assert.deepEqual(result.genres, ['Drama', 'Mystery']);
});

test('rejects items without an identifier or detail path instead of inventing one', () => {
  assert.equal(normalizeContent({ title: 'Unaddressable title' }), null);
});

test('extracts the response list shapes the API routes preserve', () => {
  assert.deepEqual(extractContentList({ items: [apiTitle] }).map((item) => item.providerItemId), ['subject-42']);
  assert.deepEqual(extractContentList({ data: { items: [apiTitle] } }).map((item) => item.providerItemId), ['subject-42']);
});

test('discovers named homepage rails without inserting catalog fixtures', () => {
  const sections = extractContentSections({ homepage: { trending: [apiTitle], popular: [{ ...apiTitle, subjectId: 'subject-43', title: 'Another title' }] } });
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map((section) => section.items[0].providerItemId), ['subject-42', 'subject-43']);
});

test('normalizes only explicit season and episode records', () => {
  const seasons = extractSeasons({ seasons: [{ se: 0, title: 'Season 1', episodes: [{ ep: 0, title: 'Episode One', duration: '42 min' }] }] });
  assert.equal(seasons.length, 1);
  assert.equal(seasons[0].apiValue, 0);
  assert.equal(seasons[0].episodes[0].apiEpisode, 0);
  assert.equal(seasons[0].episodes[0].title, 'Episode One');
  assert.equal(extractSeasons({ seasons: [] }).length, 0);
});

test('extracts live suggestion values and stores compact My List references', () => {
  assert.deepEqual(extractSuggestions({ items: [{ keyword: 'Dune' }, { title: 'Arrival' }] }), ['Dune', 'Arrival']);
  const reference = contentReference(normalizeContent(apiTitle));
  assert.equal(reference.providerItemId, 'subject-42');
  assert.equal(reference.detailPath, 'show/example');
  assert.equal(Object.hasOwn(reference, 'raw'), false);
});

test('restores only provider-tagged catalog references and rejects old fixtures', () => {
  const reference = contentReference(normalizeContent(apiTitle));
  const restored = normalizeSavedReference(reference);
  assert.equal(restored.id, reference.id);
  assert.equal(restored.providerItemId, reference.providerItemId);
  assert.equal(Object.hasOwn(restored, 'raw'), false);
  assert.equal(normalizeSavedReference({ id: 'movie-last-signal', title: 'Old sample title' }), null);
});

test('fails closed when the API base URL is not configured', async () => {
  await assert.rejects(
    () => movieBoxClient.getHomepage(),
    (error) => error instanceof MovieBoxServiceError && error.code === 'API_NOT_CONFIGURED',
  );
});
