import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_API_KEY,
  MovieBoxServiceError,
  assertApiBaseUrl,
  getMovieBoxApiBaseUrl,
  getMovieBoxApiKey,
  isMovieBoxConfigured,
  movieBoxClient,
  resolveApiConfig,
} from './client.js';
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
  assert.deepEqual(extractContentList({ subjectList: [apiTitle] }).map((item) => item.providerItemId), ['subject-42']);
  assert.deepEqual(extractContentList({ movie: [apiTitle], tv: [{ ...apiTitle, subjectId: 'subject-tv' }] }).map((item) => item.providerItemId), ['subject-42', 'subject-tv']);
});

test('discovers named homepage rails without inserting catalog fixtures', () => {
  const sections = extractContentSections({ homepage: { trending: [apiTitle], popular: [{ ...apiTitle, subjectId: 'subject-43', title: 'Another title' }] } });
  assert.equal(sections.length, 2);
  assert.deepEqual(sections.map((section) => section.items[0].providerItemId), ['subject-42', 'subject-43']);
});

test('normalizes the live API cover objects and homepage operatingList records', () => {
  const homepageTitle = {
    id: '0',
    title: 'Series Season Two',
    image: { url: 'https://images.example/backdrop.jpg' },
    subjectId: 'subject-home-1',
    subjectType: 2,
    detailPath: 'series-season-two',
    subject: {
      subjectId: 'subject-home-1',
      subjectType: 2,
      title: 'Series',
      description: 'A real catalog synopsis.',
      releaseDate: '2025-03-04',
      duration: 0,
      genre: 'Drama,Mystery',
      cover: { url: 'https://images.example/poster.jpg' },
    },
  };
  const homepage = {
    operatingList: [
      { title: 'Banner_Africa', type: 'BANNER', banner: { items: [homepageTitle] } },
      { title: 'Trending', type: 'SUBJECTS', subjects: [{ ...apiTitle, subjectId: 'subject-home-2' }] },
    ],
  };
  const sections = extractContentSections(homepage);
  assert.deepEqual(sections.map((section) => section.title), ['Banner Africa', 'Trending']);
  assert.equal(sections[0].items[0].poster, 'https://images.example/poster.jpg');
  assert.equal(sections[0].items[0].backdrop, 'https://images.example/backdrop.jpg');
  assert.equal(sections[0].items[0].synopsis, 'A real catalog synopsis.');
  assert.equal(extractContentList(homepage).length, 2);
  const searchTitle = normalizeContent({ ...apiTitle, cover: { url: 'https://images.example/search-poster.jpg' } });
  assert.equal(searchTitle.poster, 'https://images.example/search-poster.jpg');
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
  assert.deepEqual(extractSuggestions({ items: [{ word: 'Avatar: Fire and Ash' }] }), ['Avatar: Fire and Ash']);
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

test('ships a usable catalog configuration so an unconfigured clone still works', () => {
  const shipped = resolveApiConfig({});
  assert.equal(shipped.baseUrl, 'https://api.zstlab.cyou');
  assert.match(shipped.apiKey, /^zst_/);
  assert.equal(getMovieBoxApiBaseUrl(), 'https://api.zstlab.cyou');
  assert.equal(isMovieBoxConfigured(), true);
  assert.equal(getMovieBoxApiKey().length > 10, true);
});

test('environment overrides win over the built-in defaults', () => {
  const overridden = resolveApiConfig({
    VITE_MOVIEBOX_API_BASE_URL: 'https://staging.example/',
    VITE_ZST_API_KEY: 'zst_other',
  });
  assert.equal(overridden.baseUrl, 'https://staging.example');
  assert.equal(overridden.apiKey, 'zst_other');
  // A blank override must not blank out a working configuration.
  assert.equal(resolveApiConfig({ VITE_ZST_API_KEY: '   ' }).apiKey, DEFAULT_API_KEY);
  assert.equal(resolveApiConfig({ VITE_MOVIEBOX_API_BASE_URL: '' }).baseUrl, DEFAULT_API_BASE_URL);
});

test('a genuinely misconfigured build still fails closed', () => {
  assert.throws(
    () => assertApiBaseUrl(''),
    (error) => error instanceof MovieBoxServiceError && error.code === 'API_NOT_CONFIGURED',
  );
  assert.throws(
    () => assertApiBaseUrl('not-a-url'),
    (error) => error instanceof MovieBoxServiceError && error.code === 'INVALID_API_BASE_URL',
  );
  assert.throws(
    () => assertApiBaseUrl('ftp://api.example'),
    (error) => error instanceof MovieBoxServiceError && error.code === 'INVALID_API_BASE_URL',
  );
  assert.throws(
    () => assertApiBaseUrl('http://api.example', { prod: true }),
    (error) => error instanceof MovieBoxServiceError && error.code === 'INSECURE_API_BASE_URL',
  );
  assert.equal(assertApiBaseUrl('https://api.zstlab.cyou/'), 'https://api.zstlab.cyou/');
});
