import test from 'node:test';
import assert from 'node:assert/strict';

import {
  episodesFor,
  expiresAtFromUrl,
  normalizeDetails,
  normalizeHomepage,
  normalizeHotPayload,
  normalizeMediaPayload,
  normalizePagedPayload,
  normalizePopularSearches,
  normalizeSeasons,
  normalizeStreamPayload,
  normalizeSuggestions,
  normalizeTitle,
} from './normalize.js';

// Fixtures below are abridged copies of real provider responses, with host
// names and signatures replaced. No credential appears in any fixture.
//
// Every mapper receives the provider envelope's `data` object, because the
// provider adapter unwraps `{ status, statusCode, data }` before normalizing.

const seriesSubject = {
  subjectId: '8977867836450298272',
  subjectType: 2,
  title: 'Hello, Me!',
  description: 'A woman meets her younger self.',
  releaseDate: '2021-02-17',
  duration: 0,
  genre: 'Comedy,Drama,Fantasy',
  cover: { url: 'https://images.example/cover.jpg', width: 432, height: 636, avgHueDark: '#66554a' },
  countryName: 'Korea',
  imdbRatingValue: '7.3',
  imdbRatingCount: 849,
  subtitles: 'English,Arabic',
  hasResource: true,
  detailPath: 'hello-me-kclsXSfJcHa',
  stills: { url: 'https://images.example/backdrop.jpg' },
  postTitle: 'Self esteem boost!',
};

const movieSubject = {
  subjectId: '6391474290696802080',
  subjectType: 1,
  title: 'Inception',
  description: '',
  releaseDate: '2010-07-16',
  duration: 8880,
  genre: 'Action,Adventure,Sci-Fi',
  cover: { url: 'https://images.example/inception.jpg' },
  imdbRatingValue: '8.8',
  detailPath: 'inception-e1BOR6f19C7',
  trailer: { videoAddress: { url: 'https://video.example/trailer.mp4' } },
};

test('a provider subject becomes a complete VEYRA title', () => {
  const title = normalizeTitle(seriesSubject);
  assert.equal(title.id, 'zst:8977867836450298272');
  assert.equal(title.provider, 'zst');
  assert.equal(title.type, 'series');
  assert.equal(title.title, 'Hello, Me!');
  assert.equal(title.year, '2021');
  assert.equal(title.rating, '7.3');
  assert.equal(title.country, 'Korea');
  assert.deepEqual(title.genres, ['Comedy', 'Drama', 'Fantasy']);
  assert.equal(title.poster, 'https://images.example/cover.jpg');
  assert.equal(title.backdrop, 'https://images.example/backdrop.jpg');
  assert.equal(title.detailPath, 'hello-me-kclsXSfJcHa');
  assert.equal(title.hasResource, true);
  assert.deepEqual(title.subtitleLanguages, ['English', 'Arabic']);
  assert.equal(title.runtimeMinutes, undefined, 'a series has no single runtime');
});

test('a film reports its runtime in minutes and keeps its trailer', () => {
  const title = normalizeTitle(movieSubject);
  assert.equal(title.type, 'movie');
  assert.equal(title.runtimeMinutes, 148, '8880 seconds rounds to 148 minutes');
  assert.equal(title.trailerUrl, 'https://video.example/trailer.mp4');
});

test('a record without a title or a stable identifier is dropped, never invented', () => {
  assert.equal(normalizeTitle(null), null);
  assert.equal(normalizeTitle({ title: 'No identifier' }), null);
  assert.equal(normalizeTitle({ subjectId: '1' }), null);
  assert.equal(normalizeTitle('not a record'), null);
});

test('catalogue payloads read from either subjectList or items and carry a pager', () => {
  const fromTrending = normalizePagedPayload({
    page: 0,
    perPage: 18,
    subjectList: [seriesSubject],
    pager: { hasMore: true, nextPage: '1', page: '0', perPage: 18, totalCount: 0 },
  });
  assert.equal(fromTrending.items.length, 1);
  assert.equal(fromTrending.pager.hasMore, true);
  assert.equal(fromTrending.pager.nextPage, 1);

  const fromSearch = normalizePagedPayload({
    page: 1,
    perPage: 24,
    items: [movieSubject, movieSubject],
    pager: { hasMore: false, page: '1', perPage: 24, totalCount: 68 },
  });
  assert.equal(fromSearch.items.length, 1, 'the same title is not repeated in one page');
  assert.equal(fromSearch.pager.totalCount, 68);
  assert.equal(fromSearch.pager.hasMore, false);
  assert.equal(fromSearch.pager.nextPage, undefined);
});

test('the homepage keeps only content rails, hides promotional names and drops empties', () => {
  const { hero, rails } = normalizeHomepage({
    operatingList: [
        { type: 'BANNER', position: 1, title: 'Banner_Africa', banner: { items: [{ subject: movieSubject }] } },
        { type: 'SUBJECTS_MOVIE', position: 3, title: 'Popular Series', subjects: [seriesSubject] },
        { type: 'SUBJECTS_MOVIE', position: 4, title: 'Popular Series', subjects: [seriesSubject], },
        { type: 'SUBJECTS_MOVIE', position: 4, title: 'Empty Rail', subjects: [] },
        { type: 'SUBJECTS_MOVIE', position: 4, title: 'Get the VIP!', subjects: [movieSubject] },
        { type: 'CUSTOM', position: 5, title: 'Hot TV Channels', subjects: [movieSubject] },
        { type: 'FILTER', position: 4, title: 'Categories', filters: [{ name: 'x' }] },
        { type: 'APPOINTMENT_LIST', position: 4, title: 'Coming Soon', subjects: [movieSubject] },
      { type: 'PLAY_LIST', position: 8, title: 'Popular Movies', subjects: [movieSubject] },
    ],
  });

  assert.equal(hero.length, 1);
  assert.equal(hero[0].title, 'Inception');
  assert.deepEqual(
    rails.map((rail) => rail.title),
    ['Popular Series', 'Coming Soon', 'Popular Movies'],
    'promotional, duplicate and empty sections never reach the interface',
  );
});

test('hot movies and series are split into their own rails', () => {
  const { movies, series } = normalizeHotPayload({ movie: [movieSubject], tv: [seriesSubject] });
  assert.equal(movies.length, 1);
  assert.equal(series.length, 1);
  assert.equal(series[0].type, 'series');
});

test('popular searches and suggestions are unwrapped and de-duplicated', () => {
  assert.deepEqual(
    normalizePopularSearches({ everyoneSearch: [{ title: 'Neagley' }, { title: 'neagley' }, { title: 'Teen Wolf' }] }),
    ['Neagley', 'Teen Wolf'],
  );
  assert.deepEqual(
    normalizeSuggestions({ items: [{ type: 0, word: 'Stranger Things' }, { word: 'Stranger Things' }, { word: 'Straw' }] }),
    [{ word: 'Stranger Things', kind: 'title' }, { word: 'Straw', kind: 'title' }],
  );
});

test('details map the subject, the cast and the real season structure', () => {
  const details = normalizeDetails({
    subject: seriesSubject,
    stars: [
      { staffId: '1', name: 'Lee Hyeon-Suk', character: 'Director' },
      { name: 'Kim Mi-kyung', character: 'Actor' },
      { character: 'Nameless' },
    ],
    resource: { seasons: [{ se: 1, maxEp: 16, resolutions: [{ resolution: 1080, epNum: 16 }, { resolution: 480, epNum: 16 }, { resolution: 1080, epNum: 16 }], uploadBy: 'someone' }] },
  }, { subjectId: '8977867836450298272' });

  assert.equal(details.title.title, 'Hello, Me!');
  assert.equal(details.title.cast.length, 2, 'a cast row without a name is dropped');
  assert.equal(details.title.cast[0].character, 'Director');
  assert.equal(details.title.seasons.length, 1);
  assert.equal(details.title.episodeCount, 16);
  assert.equal(details.title.seasons[0].episodes.length, 16, 'episodes are derived from the real count');
  assert.equal(details.title.seasons[0].episodes[0].label, 'Episode 1');
  assert.equal(details.title.seasons[0].episodes[15].id, 's1e16');
  assert.deepEqual(details.title.seasons[0].resolutions, [1080, 480], 'resolutions are unique and descending');
});

test('seasons without an episode count are not rendered as empty lists', () => {
  assert.deepEqual(normalizeSeasons({ resource: { seasons: [{ se: 1 }] } }), []);
  const seasons = normalizeSeasons({ resource: { seasons: [{ se: 2, maxEp: 3 }, { se: 1, maxEp: 2 }] } });
  assert.deepEqual(seasons.map((season) => season.season), [1, 2], 'seasons are ordered');
  assert.equal(episodesFor(seasons, 2).length, 3);
  assert.deepEqual(episodesFor(seasons, 9), []);
});

const mediaPayload = {
  stream: {
    data: {
      streams: [
          { format: 'MP4', id: '178', url: 'https://cdn.example/1080.mp4?sign=aa&t=1791360623', resolutions: '1080', size: '2414667149', duration: 8888, codecName: 'h264' },
          { format: 'MP4', id: '179', url: 'https://cdn.example/480.mp4?sign=bb&t=1791360623', resolutions: '480', size: '888312785' },
        ],
        hls: [{ url: 'https://cdn.example/master.m3u8', id: 'hls' }],
        dash: [],
        hasResource: true,
        limited: false,
      },
    },
    downloads: {
      data: {
        downloads: [
          { id: '178', url: 'https://cdn.example/1080.mp4', resolution: 1080, size: '2414667149', streamUrl: 'https://proxy.example/api/proxy?url=1080', downloadUrl: 'https://proxy.example/api/proxy-download?url=1080' },
          { id: '179', url: 'https://cdn.example/480.mp4', resolution: 480, size: '888312785', streamUrl: 'https://proxy.example/api/proxy?url=480', downloadUrl: 'https://proxy.example/api/proxy-download?url=480' },
        ],
        captions: [{ id: 'c1', lan: 'ar', lanName: 'Arabic', url: 'https://cdn.example/ar.srt', size: '79396', delay: 0 }],
        hasResource: true,
      },
    },
    subtitles: {
      data: {
        captions: [
          { id: 'c1', lan: 'ar', lanName: 'Arabic', url: 'https://proxy.example/api/proxy-download?url=ar.srt', size: '79396', delay: 120 },
          { id: 'c2', lan: 'en', lanName: 'English' },
        ],
      },
    },
};

test('playback sources prefer the authorized proxy and keep a direct fallback', () => {
  const media = normalizeMediaPayload(mediaPayload);
  assert.equal(media.sources.length, 3);
  const top = media.sources[0];
  assert.equal(top.height, 1080);
  assert.equal(top.label, '1080p');
  assert.equal(top.url, 'https://proxy.example/api/proxy?url=1080', 'playback goes through the proxy');
  assert.equal(top.fallbackUrl, 'https://cdn.example/1080.mp4?sign=aa&t=1791360623', 'the direct CDN URL is retained for retry');
  assert.equal(top.proxied, true);
  assert.equal(top.durationSec, 8888);
  assert.equal(top.codec, 'h264');
  assert.equal(top.sizeBytes, 2414667149);
});

test('caption tracks come from the subtitle block and unusable entries are dropped', () => {
  const media = normalizeMediaPayload(mediaPayload);
  assert.equal(media.subtitles.length, 1, 'a caption without a URL is not offered');
  assert.deepEqual(media.subtitles[0], {
    id: 'c1',
    lang: 'ar',
    label: 'Arabic',
    url: 'https://proxy.example/api/proxy-download?url=ar.srt',
    sizeBytes: 79396,
    delayMs: 120,
  });
});

test('download entries keep the authorized download URL and its real size', () => {
  const media = normalizeMediaPayload(mediaPayload);
  assert.equal(media.downloads.length, 2);
  assert.equal(media.downloads[1].label, '480p');
  assert.equal(media.downloads[1].sizeBytes, 888312785);
  assert.match(media.downloads[1].downloadUrl, /proxy-download/);
});

test('an expiring playback URL reports its expiry so it can be refreshed', () => {
  assert.equal(expiresAtFromUrl('https://cdn.example/a.mp4?sign=x&t=1791360623'), 1791360623000);
  assert.equal(expiresAtFromUrl('https://proxy.example/api/proxy?url=https%3A%2F%2Fcdn.example%2Fa.mp4%3Ft%3D1791360623'), 1791360623000);
  assert.equal(expiresAtFromUrl('https://cdn.example/a.mp4'), undefined);
  const media = normalizeMediaPayload(mediaPayload);
  assert.equal(media.expiresAt, 1791360623000);
});

test('a title with no resources yields an empty package instead of a fake source', () => {
  const media = normalizeMediaPayload({ stream: { data: { streams: [], hls: [], dash: [], hasResource: false } }, downloads: { data: { downloads: [] } } });
  assert.deepEqual(media.sources, []);
  assert.deepEqual(media.subtitles, []);
  assert.equal(media.hasResource, false);
});

test('the stream route maps through the same media normalizer', () => {
  const media = normalizeStreamPayload({ streams: [{ url: 'https://cdn.example/720.mp4', resolutions: '720', format: 'MP4' }], hasResource: true });
  assert.equal(media.sources.length, 1);
  assert.equal(media.sources[0].height, 720);
  assert.equal(media.sources[0].proxied, false);
});
