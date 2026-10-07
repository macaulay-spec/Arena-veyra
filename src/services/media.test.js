import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MediaResolutionError,
  clearMediaCache,
  pickSource,
  pickSubtitleTrack,
  qualityOptions,
  resolveDownload,
  resolveMedia,
  resolveStream,
} from './media.js';

const media = {
  sources: [
    { id: '1080', label: '1080p', url: 'https://proxy.example/1080', type: 'video', height: 1080 },
    { id: '720', label: '720p', url: 'https://proxy.example/720', type: 'video', height: 720 },
    { id: '360', label: '360p', url: 'https://proxy.example/360', type: 'video', height: 360 },
  ],
  subtitles: [
    { id: 'en', label: 'English', language: 'en', url: 'https://proxy.example/en.srt' },
    { id: 'es', label: 'Español', language: 'es', url: 'https://proxy.example/es.srt' },
  ],
};

const item = { id: 'zst:42', subjectId: '42', detailPath: 'a-title', title: 'A Title' };
const episode = { id: 'zst:42:s1e2', seasonNumber: 1, episodeNumber: 2 };

function stubFetch(handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const parsed = new URL(url);
    calls.push({ path: parsed.pathname, params: parsed.searchParams, options });
    return handler(parsed, options);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: () => 'application/json' },
  json: async () => body,
});

const mediaPayload = {
  status: true,
  data: {
    sources: [{ id: '1080', label: '1080p', height: 1080, url: 'https://proxy.example/1080', type: 'video' }],
    subtitles: [{ id: 'en', lang: 'en', label: 'English', url: 'https://proxy.example/en.srt' }],
    downloads: [{ id: 'd', label: '1080p', height: 1080, downloadUrl: 'https://proxy.example/dl', sizeBytes: 100 }],
  },
};

test('auto quality takes the best available source', () => {
  assert.equal(pickSource(media, { quality: 'Auto' }).id, '1080');
});

test('a requested quality is honoured and falls back sensibly', () => {
  assert.equal(pickSource(media, { quality: '720p' }).id, '720');
  assert.equal(pickSource(media, { quality: '480p' }).id, '360', 'falls back to the closest smaller source');
  assert.equal(pickSource(media, { quality: '1080p' }).id, '1080');
  assert.equal(pickSource({ sources: [] }), null);
});

test('data saver caps the source and quality options stay unique', () => {
  assert.equal(pickSource(media, { quality: 'Auto', dataSaver: true }).id, '360');
  assert.deepEqual(qualityOptions(media).map((option) => option.label), ['Auto', '1080p', '720p', '360p']);
  assert.deepEqual(qualityOptions({ sources: [] }).map((option) => option.label), ['Auto'], 'no quality is offered before one exists');
});

test('subtitles follow the viewer preference, otherwise the first track', () => {
  assert.equal(pickSubtitleTrack(media, { enabled: false }), null);
  assert.equal(pickSubtitleTrack(media, { enabled: true, language: 'Español' }).id, 'es');
  assert.equal(pickSubtitleTrack(media, { enabled: true, language: 'Klingon' }).id, 'en');
  assert.equal(pickSubtitleTrack({ sources: [], subtitles: [] }, { enabled: true }), null);
});

test('media resolution asks the VEYRA API with the real playback parameters', async () => {
  clearMediaCache();
  const stub = stubFetch(() => json(mediaPayload));
  try {
    const resolved = await resolveMedia({ item, episode });
    const call = stub.calls[0];
    assert.equal(call.path, '/api/veyra/media');
    assert.equal(call.params.get('subjectId'), '42');
    assert.equal(call.params.get('detailPath'), 'a-title');
    assert.equal(call.params.get('season'), '1');
    assert.equal(call.params.get('episode'), '2');
    assert.equal(resolved.sources.length, 1);
    assert.equal(resolved.subtitles.length, 1);
  } finally {
    stub.restore();
  }
});

test('a resolved package is reused briefly and can be forced to refresh', async () => {
  clearMediaCache();
  const stub = stubFetch(() => json(mediaPayload));
  try {
    await resolveMedia({ item });
    await resolveMedia({ item });
    assert.equal(stub.calls.length, 1, 'a second read within the window is served from memory');
    await resolveMedia({ item, force: true });
    assert.equal(stub.calls.length, 2);
  } finally {
    stub.restore();
  }
});

test('a specific quality is re-resolved for real instead of relabelled', async () => {
  clearMediaCache();
  const stub = stubFetch(() => json({ status: true, data: { sources: [{ id: '480', label: '480p', height: 480, url: 'https://proxy.example/480', type: 'video' }] } }));
  try {
    const stream = await resolveStream({ item, episode, quality: '480p' });
    const call = stub.calls[0];
    assert.equal(call.path, '/api/veyra/stream');
    assert.equal(call.params.get('quality'), '480');
    assert.equal(stream.sources[0].height, 480);
  } finally {
    stub.restore();
  }
});

test('an empty package fails closed instead of inventing a stream', async () => {
  clearMediaCache();
  const stub = stubFetch(() => json({ status: true, data: { sources: [], subtitles: [] } }));
  try {
    await assert.rejects(() => resolveMedia({ item, force: true }), (error) => error instanceof MediaResolutionError && error.code === 'PLAYBACK_UNAVAILABLE');
  } finally {
    stub.restore();
  }
});

test('a title with no identifier never reaches the network', async () => {
  clearMediaCache();
  const stub = stubFetch(() => json(mediaPayload));
  try {
    await assert.rejects(
      () => resolveMedia({ item: { id: 'zst:1', title: 'No identifier' } }),
      (error) => error.code === 'PLAYBACK_UNAVAILABLE',
    );
    assert.equal(stub.calls.length, 0);
    await assert.rejects(() => resolveMedia({}), (error) => error instanceof MediaResolutionError);
  } finally {
    stub.restore();
  }
});

test('a cancelled playback request stays silent', async () => {
  clearMediaCache();
  const controller = new AbortController();
  const stub = stubFetch((url, options) => new Promise((resolve, reject) => {
    options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    void resolve;
  }));
  try {
    const pending = resolveMedia({ item, signal: controller.signal });
    controller.abort();
    await assert.rejects(() => pending, (error) => error.code === 'ABORTED');
  } finally {
    stub.restore();
  }
});

test('download metadata comes from the authorized route and fails cleanly', async () => {
  const stub = stubFetch(() => json({ status: true, data: { url: 'https://proxy.example/dl', label: '480p', height: 480, sizeBytes: 42, qualities: [] } }));
  try {
    const download = await resolveDownload({ item, quality: '480p' });
    assert.equal(download.url, 'https://proxy.example/dl');
    assert.equal(stub.calls[0].params.get('quality'), '480');
  } finally {
    stub.restore();
  }
  const failing = stubFetch(() => json({ status: false, error: { code: 'DOWNLOAD_UNAVAILABLE', message: 'no' } }, 404));
  try {
    await assert.rejects(() => resolveDownload({ item }), (error) => error.code === 'DOWNLOAD_UNAVAILABLE');
  } finally {
    failing.restore();
  }
});
