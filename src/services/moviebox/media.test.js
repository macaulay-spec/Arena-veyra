import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApiProxyUrl, isApiProxyUrl, probeDownloadAvailability, probeMediaUrl, unwrapApiProxyUrl } from './client.js';
import {
  extractNotice,
  extractPager,
  extractSearchPage,
  extractSeasons,
  normalizeContent,
  normalizeMedia,
} from './normalize.js';
import { srtToVtt } from './subtitles.js';

const mediaPayload = {
  downloads: {
    code: 0,
    message: 'ok',
    data: {
      downloads: [
        {
          id: '1',
          url: 'https://cdn.example/360.mp4?sign=a',
          resolution: 360,
          size: '777303372',
          streamUrl: 'https://api.example/api/proxy?url=https%3A%2F%2Fcdn.example%2F360.mp4%3Fsign%3Da',
          downloadUrl: 'https://api.example/api/proxy-download?url=https%3A%2F%2Fcdn.example%2F360.mp4%3Fsign%3Da',
        },
        {
          id: '2',
          url: 'https://cdn.example/1080.mp4?sign=b',
          resolution: 1080,
          size: '2414667149',
          streamUrl: 'https://api.example/api/proxy?url=https%3A%2F%2Fcdn.example%2F1080.mp4%3Fsign%3Db',
          downloadUrl: 'https://api.example/api/proxy-download?url=https%3A%2F%2Fcdn.example%2F1080.mp4%3Fsign%3Db',
        },
        { id: '3', resolution: 480, size: '888312785' }, // no stream and no url: must be dropped
      ],
      captions: [
        { id: 'c1', lan: 'en', lanName: 'English', url: 'https://cacdn.example/subtitle/en.srt?sign=x', size: '3765' },
        { id: 'c2', lan: 'fr', lanName: 'Français', url: 'https://api.example/api/proxy-download?url=https%3A%2F%2Fcacdn.example%2Fmsubt%2Ffr.srt%3Fsign%3Dy&season=0&episode=0', size: '4000' },
      ],
      hasResource: true,
    },
  },
  stream: {
    code: 0,
    message: 'ok',
    data: {
      streams: [{ format: 'MP4', url: 'https://cdn.example/1080.mp4?sign=b', resolutions: '1080', duration: 8888, codecName: 'h264' }],
      dash: [],
      hls: [],
      hasResource: true,
    },
  },
};

test('normalizeMedia keeps only qualities the player can actually open', () => {
  const media = normalizeMedia(mediaPayload);
  assert.equal(media.hasResource, true);
  assert.deepEqual(media.qualities.map((quality) => quality.resolution), [1080, 360]);
  assert.deepEqual(media.qualities.map((quality) => quality.label), ['1080p', '360p']);
  assert.equal(media.qualities[0].sizeBytes, 2414667149);
  assert.ok(media.qualities.every((quality) => quality.streamUrl.startsWith('https://api.example/api/proxy')));
  assert.equal(media.duration, 8888);
});

test('normalizeMedia exposes only the caption languages returned, never a broken link', () => {
  const media = normalizeMedia(mediaPayload);
  assert.deepEqual(media.captions.map((caption) => caption.lang).sort(), ['en', 'fr']);
  const french = media.captions.find((caption) => caption.lang === 'fr');
  assert.equal(french.language, 'Français');
  // Caption links are always absolute and are rebuilt away from the
  // maintenance-prone proxy-download route whenever a base URL is configured.
  assert.match(french.url, /^https:\/\//);
  assert.ok(!/\/api\/proxy-download/.test(french.url));
  assert.equal(buildApiProxyUrl('https://cacdn.example/subtitle/en.srt'), 'https://api.zstlab.cyou/api/proxy?url=https%3A%2F%2Fcacdn.example%2Fsubtitle%2Fen.srt');
});

test('provider proxy links are recognised by path so they can be rebuilt', () => {
  const link = 'https://api.example/api/proxy-download?url=https%3A%2F%2Fcacdn.example%2Fmsubt%2Ffr.srt%3Fsign%3Dy&season=0&episode=0';
  assert.equal(isApiProxyUrl(link), true);
  assert.equal(unwrapApiProxyUrl(link), 'https://cacdn.example/msubt/fr.srt?sign=y');
  assert.equal(isApiProxyUrl('https://cacdn.example/subtitle/en.srt'), false);
});

test('normalizeMedia reports an unavailable title instead of inventing streams', () => {
  const media = normalizeMedia({ downloads: { data: { downloads: [], captions: [], hasResource: false } }, stream: { data: { streams: [], dash: [], hls: [], hasResource: false } } });
  assert.equal(media.hasResource, false);
  assert.deepEqual(media.qualities, []);
  assert.deepEqual(media.captions, []);
});

test('normalizeMedia accepts the raw envelope shape too', () => {
  const media = normalizeMedia({ data: mediaPayload });
  assert.equal(media.qualities.length, 2);
});

test('normalizeContent reads the provider stars array for director and cast', () => {
  const content = normalizeContent({
    subjectId: '6391474290696802080',
    subjectType: 1,
    title: 'Inception',
    detailPath: 'inception-e1BOR6f19C7',
    duration: 8880,
    genre: 'Action,Adventure,Sci-Fi',
    hasResource: true,
    stars: [
      { staffType: 2, name: 'Christopher Nolan', character: 'Director' },
      { staffType: 1, name: 'Leonardo DiCaprio', character: 'Cobb' },
      { staffType: 1, name: 'Leonardo DiCaprio', character: 'Cobb' },
      { staffType: 3, name: 'Christopher Nolan', character: 'Writer' },
    ],
  });
  assert.equal(content.director, 'Christopher Nolan');
  assert.deepEqual(content.cast, ['Leonardo DiCaprio']);
  assert.equal(content.runtime, '2h 28m');
  assert.equal(content.hasResource, true);
});

test('extractSeasons keeps provider season numbers and never invents gapped episodes', () => {
  const seasons = extractSeasons({ resource: { seasons: [{ se: 2, maxEp: 3, allEp: '', resolutions: [{ resolution: 1080, epNum: 3 }] }] } });
  assert.equal(seasons[0].apiValue, 2);
  assert.equal(seasons[0].label, 'Season 2');
  assert.deepEqual(seasons[0].episodes.map((episode) => episode.episodeNo), [1, 2, 3]);
  assert.ok(seasons[0].episodes.every((episode) => episode.apiSeason === 2));

  const gapped = extractSeasons({ resource: { seasons: [{ se: 1, maxEp: 5, allEp: '1,3,5' }] } });
  assert.deepEqual(gapped[0].episodes.map((episode) => episode.episodeNo), [1, 3, 5]);
});

test('extractSearchPage surfaces the provider pager for load more', () => {
  const page = extractSearchPage({ pager: { hasMore: true, nextPage: '2', page: '1', perPage: 24, totalCount: 70 }, items: [{ subjectId: '1', title: 'Inception', detailPath: 'inception-e1BOR6f19C7', subjectType: 1 }] });
  assert.equal(page.items.length, 1);
  assert.equal(page.pager.hasMore, true);
  assert.equal(page.pager.nextPage, 2);
  assert.equal(extractPager({ pager: { hasMore: false, nextPage: '3' } }).hasMore, false);
});

test('extractNotice only surfaces a real operator banner', () => {
  assert.equal(extractNotice({ banner: null, topPickList: [] }), '');
  assert.equal(extractNotice({ banner: 'Streaming is under maintenance right now.' }), 'Streaming is under maintenance right now.');
  assert.equal(extractNotice({ data: { notice: { message: 'Downloads are paused.' } } }), 'Downloads are paused.');
});

test('srtToVtt converts SubRip cues and rejects non-caption payloads', () => {
  const vtt = srtToVtt('1\r\n00:00:55,680 --> 00:00:57,473\r\n[CHILDREN LAUGHING]\r\n\r\n2\r\n00:01:12,072 --> 00:01:13,197\r\nAre you here to kill me?\r\n');
  assert.ok(vtt.startsWith('WEBVTT\n\n'));
  assert.match(vtt, /00:00:55\.680 --> 00:00:57\.473/);
  assert.match(vtt, /Are you here to kill me\?/);
  assert.throws(() => srtToVtt('<html><body>404</body></html>'));
});

test('probes never invent availability', async () => {
  assert.deepEqual(await probeDownloadAvailability('', {}), { available: false, reason: 'NO_DOWNLOAD_URL' });
  assert.deepEqual(await probeMediaUrl('not-a-url'), { ok: false, reason: 'NO_URL' });
  // No target URL means no proxy link, even with a base URL configured.
  assert.equal(buildApiProxyUrl(''), undefined);
  assert.equal(buildApiProxyUrl('not-a-url'), undefined);
  // A raw CDN link is rebuilt onto the provider proxy, which is the URL the
  // provider itself serves for playback.
  assert.equal(buildApiProxyUrl('https://cdn.example/360.mp4'), 'https://api.zstlab.cyou/api/proxy?url=https%3A%2F%2Fcdn.example%2F360.mp4');
});
