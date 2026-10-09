import test from 'node:test';
import assert from 'node:assert/strict';

import { catalogApi, clearCatalogCache } from './catalog.js';

const payloads = {
  '/home': {
    status: true,
    data: {
      hero: [{ id: 'zst:h', subjectId: 'h', title: 'Hero', type: 'movie' }],
      rails: [{ id: 'r1', title: 'Popular Series', items: [{ id: 'zst:1', subjectId: '1', title: 'One', type: 'series' }] }],
    },
  },
  '/trending': { status: true, data: { items: [{ id: 'zst:2', subjectId: '2', title: 'Two' }], pager: { hasMore: true, nextPage: 1, page: 0, perPage: 18, totalCount: 40 } } },
  '/hot': { status: true, data: { rails: [{ id: 'zst-hot:movies', title: 'Popular Movies', items: [{ id: 'zst:3', subjectId: '3', title: 'Three' }] }] } },
  '/popular-searches': { status: true, data: { terms: ['Neagley', 'Teen Wolf'] } },
  '/suggestions': { status: true, data: { items: [{ word: 'Stra' }, { word: 'Straw' }] } },
  '/details': {
    status: true,
    data: {
      title: { id: 'zst:9', subjectId: '9', title: 'Nine', type: 'series', seasons: [{ seasonNumber: 1, episodeCount: 2, episodes: [{ episodeNumber: 1 }, { episodeNumber: 2 }] }] },
    },
  },
  '/recommendations': { status: true, data: { items: [{ id: 'zst:10', subjectId: '10', title: 'Ten' }] } },
};

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, params: parsed.searchParams, options });
    return handler(parsed, options);
  };
  return {
    calls,
    restore: () => { globalThis.fetch = original; },
  };
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

test('home combines the featured list with content rails', async () => {
  clearCatalogCache();
  const stub = stubFetch((url) => json(payloads[url.pathname.replace('/api/veyra', '')]));
  try {
    const home = await catalogApi.getHome();
    assert.equal(home.hero[0].title, 'Hero');
    assert.equal(home.rails[0].title, 'Popular Series');
    assert.equal(home.rails[0].items[0].id, 'zst:1');
    assert.match(stub.calls[0].path, /\/api\/veyra\/home$/);
  } finally {
    stub.restore();
  }
});

test('catalogue reads are cached, and a forced read bypasses the cache', async () => {
  clearCatalogCache();
  const stub = stubFetch((url) => json(payloads[url.pathname.replace('/api/veyra', '')]));
  try {
    await catalogApi.getTrending({ page: 0, perPage: 18 });
    await catalogApi.getTrending({ page: 0, perPage: 18 });
    assert.equal(stub.calls.length, 1, 'a repeat view does not hit the network again');
    await catalogApi.getHome({ force: true });
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('search passes the real query names and returns a pager', async () => {
  clearCatalogCache();
  const stub = stubFetch((url) => json({ status: true, data: { items: [{ id: 'zst:5', subjectId: '5', title: 'Five' }], pager: { hasMore: true, nextPage: 2, page: 1, perPage: 24, totalCount: 68 } } }));
  try {
    const result = await catalogApi.search({ query: 'Inception', subjectType: 'MOVIES', page: 1, perPage: 24 });
    const call = stub.calls[0];
    assert.equal(call.path, '/api/veyra/search');
    assert.equal(call.params.get('query'), 'Inception');
    assert.equal(call.params.get('subjectType'), 'MOVIES');
    assert.equal(call.params.get('perPage'), '24');
    assert.equal(result.items.length, 1);
    assert.equal(result.pager.totalCount, 68);
    assert.equal(result.pager.hasMore, true);
  } finally {
    stub.restore();
  }
});

test('suggestions and popular terms are returned as plain strings', async () => {
  clearCatalogCache();
  const stub = stubFetch((url) => json(payloads[url.pathname.replace('/api/veyra', '')]));
  try {
    assert.deepEqual(await catalogApi.getSuggestions({ query: 'stra' }), ['Stra', 'Straw']);
    assert.deepEqual(await catalogApi.getPopularSearches(), ['Neagley', 'Teen Wolf']);
  } finally {
    stub.restore();
  }
});

test('details and recommendations map into display models', async () => {
  clearCatalogCache();
  const stub = stubFetch((url) => json(payloads[url.pathname.replace('/api/veyra', '')]));
  try {
    const details = await catalogApi.getDetails({ subjectId: '9' });
    assert.equal(details.title.title, 'Nine');
    assert.equal(details.seasons[0].episodes.length, 2);
    const recommendations = await catalogApi.getRecommendations({ subjectId: '9' });
    assert.equal(recommendations.items[0].title, 'Ten');
  } finally {
    stub.restore();
  }
});

test('a service error keeps its code and message instead of becoming a generic failure', async () => {
  clearCatalogCache();
  const stub = stubFetch(() => json({ status: false, error: { code: 'CATALOG_UNAVAILABLE', message: 'The catalogue service is unavailable.' } }, 502));
  try {
    await assert.rejects(() => catalogApi.getHome({ force: true }), (error) => {
      assert.equal(error.code, 'CATALOG_UNAVAILABLE');
      assert.equal(error.status, 502);
      return true;
    });
  } finally {
    stub.restore();
  }
});

test('an unreachable service raises a retryable network failure', async () => {
  clearCatalogCache();
  const stub = stubFetch(() => { throw new TypeError('failed to fetch'); });
  try {
    await assert.rejects(() => catalogApi.search({ query: 'x' }), (error) => error.code === 'NETWORK_ERROR' && error.retryable === true);
  } finally {
    stub.restore();
  }
});

test('cancelling a search surfaces ABORTED so the UI stays quiet', async () => {
  clearCatalogCache();
  const controller = new AbortController();
  const stub = stubFetch((url, options) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    controller.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    void resolve;
  }));
  try {
    const pending = catalogApi.search({ query: 'slow', signal: controller.signal });
    controller.abort();
    await assert.rejects(() => pending, (error) => error.code === 'ABORTED');
  } finally {
    stub.restore();
  }
});

test('a transient server failure is retried once before it surfaces', async () => {
  clearCatalogCache();
  let attempts = 0;
  const stub = stubFetch(() => {
    attempts += 1;
    return attempts === 1
      ? json({ status: false, error: { code: 'CATALOG_UNAVAILABLE', message: 'busy' } }, 503)
      : json({ status: true, data: { terms: ['ok'] } });
  });
  try {
    assert.deepEqual(await catalogApi.getPopularSearches(), ['ok']);
    assert.equal(attempts, 2);
  } finally {
    stub.restore();
  }
});
