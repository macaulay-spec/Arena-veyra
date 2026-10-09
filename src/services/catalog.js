// VEYRA catalog service.
//
// What the screens call. It composes the API transport with the model guards
// and keeps a short in-memory cache so moving between screens does not repeat
// a request. Nothing provider-specific and no media URL exists above this line.

import { apiRequest } from './api/client.js';
import {
  readDetails,
  readHome,
  readPaged,
  readSeason,
  readSuggestions,
  readTerms,
} from './api/normalize.js';

const cache = new Map();

const TTL = {
  home: 90_000,
  trending: 60_000,
  hot: 60_000,
  popular: 300_000,
  details: 300_000,
  recommendations: 300_000,
};

async function cached(key, ttlMs, produce) {
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  const value = await produce();
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  if (cache.size > 60) cache.delete(cache.keys().next().value);
  return value;
}

export function clearCatalogCache() {
  cache.clear();
}

export const catalogApi = Object.freeze({
  /** Featured titles plus the content rails the provider actually returned. */
  getHome: ({ signal, force = false } = {}) => (force ? apiRequest('/home', {}, { signal }) : cached('home', TTL.home, () => apiRequest('/home', {}, { signal })))
    .then(readHome),

  getTrending: ({ page = 0, perPage = 18, signal } = {}) => cached(`trending:${page}:${perPage}`, TTL.trending,
    () => apiRequest('/trending', { page, perPage }, { signal })).then(readPaged),

  getHot: ({ signal } = {}) => cached('hot', TTL.hot, () => apiRequest('/hot', {}, { signal })),

  getPopularSearches: ({ signal } = {}) => cached('popular', TTL.popular,
    () => apiRequest('/popular-searches', {}, { signal })).then(readTerms),

  search: ({ query, subjectType = 'ALL', page = 1, perPage = 24, signal }) => apiRequest('/search',
    { query, subjectType, page, perPage }, { signal, retries: 1 }).then((payload) => {
    const { items, pager } = readPaged(payload);
    return { items, pager, query: payload?.query || query };
  }),

  getSuggestions: ({ query, signal }) => apiRequest('/suggestions', { query }, { signal, retries: 0 })
    .then((payload) => readSuggestions(payload).map((entry) => entry.word)),

  getDetails: ({ subjectId, detailPath, signal, force = false }) => {
    const key = `details:${subjectId || detailPath}`;
    const produce = () => apiRequest('/details', { subjectId, detailPath }, { signal }).then(readDetails);
    return force ? produce() : cached(key, TTL.details, produce);
  },

  /** Seasons and their episodes, straight from the provider's real counts. */
  getEpisodes: ({ subjectId, detailPath, season, signal }) => apiRequest('/episodes', { subjectId, detailPath, season }, { signal })
    .then((payload) => {
      const seasons = (Array.isArray(payload?.seasons) ? payload.seasons : []).map(readSeason).filter(Boolean);
      const selected = seasons.find((entry) => entry.seasonNumber === payload?.season) || seasons[0];
      return { seasons, season: selected?.seasonNumber, episodes: selected?.episodes || [] };
    }),

  getRecommendations: ({ subjectId, detailPath, page = 1, perPage = 24, signal }) => {
    const key = `recommendations:${subjectId || detailPath}:${page}`;
    return cached(key, TTL.recommendations, () => apiRequest('/recommendations', { subjectId, detailPath, page, perPage }, { signal }))
      .then((payload) => {
        const { items, pager } = readPaged(payload);
        return { items, pager };
      });
  },
});
