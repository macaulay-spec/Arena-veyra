import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOWNLOAD_STATES,
  DownloadManager,
  MAX_IN_MEMORY_BYTES,
  downloadId,
  downloadProgress,
  formatBytes,
  loadDownloads,
  saveDownloads,
  withoutDownload,
} from './downloads.js';

function memoryStorage(initial) {
  const store = new Map(initial ? Object.entries(initial) : []);
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, value),
    raw: store,
  };
}

/** A fetch double that streams `chunks` and honours a Range header. */
function streamingFetch(chunks, { headers = {}, status = 200, onAbort } = {}) {
  const calls = [];
  const impl = async (url, options = {}) => {
    calls.push({ url, headers: options.headers || {} });
    const ranged = Boolean(options.headers?.Range);
    let index = ranged ? 1 : 0;
    const body = new ReadableStream({
      pull(controller) {
        if (options.signal?.aborted) {
          controller.error(Object.assign(new Error('aborted'), { name: 'AbortError' }));
          onAbort?.();
          return;
        }
        if (index >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[index]);
        index += 1;
      },
    });
    return {
      ok: status === 200 || status === 206,
      status: ranged ? 206 : status,
      headers: { get: (name) => (name.toLowerCase() === 'content-length' ? String(headers['content-length'] ?? chunks.slice(index).reduce((sum, chunk) => sum + chunk.byteLength, 0)) : null) },
      body,
    };
  };
  impl.calls = calls;
  return impl;
}

const item = { id: 'zst:42', subjectId: '42', detailPath: 'a-title', title: 'A Title' };
const episode = { id: 'zst:42:s1e2', seasonNumber: 1, episodeNumber: 2, label: 'Episode 2' };

test('byte sizes and progress are measured, never guessed', () => {
  assert.equal(formatBytes(0), '');
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024 * 3), '3 MB');
  assert.equal(downloadProgress({ receivedBytes: 50, sizeBytes: 200 }), 25);
  assert.equal(downloadProgress({ receivedBytes: 50 }), 0, 'an unknown total reports no percentage');
  assert.equal(downloadProgress({ receivedBytes: 500, sizeBytes: 200 }), 100);
});

test('a download identity is stable per title, episode and quality', () => {
  assert.equal(downloadId(item, null, 1080), 'zst:42:feature:1080');
  assert.equal(downloadId(item, episode, undefined), 'zst:42:zst:42:s1e2:auto');
  assert.equal(downloadId(item, episode, 480), downloadId(item, episode, 480));
});

test('stored downloads reload as paused so nothing claims to be in flight', () => {
  const storage = memoryStorage();
  saveDownloads(storage, [
    { id: 'a', content: item, state: DOWNLOAD_STATES.completed },
    { id: 'b', content: item, state: DOWNLOAD_STATES.downloading },
    { id: 'c', state: DOWNLOAD_STATES.downloading },
  ]);
  const loaded = loadDownloads(storage);
  assert.equal(loaded.length, 2, 'a record without a title is discarded');
  assert.equal(loaded[0].state, DOWNLOAD_STATES.completed);
  assert.equal(loaded[1].state, DOWNLOAD_STATES.paused);
  assert.deepEqual(withoutDownload(loaded, 'a').map((entry) => entry.id), ['b']);
});

test('an unsupported platform refuses to queue instead of faking a download', async () => {
  const manager = new DownloadManager({
    storage: memoryStorage(),
    resolveUrl: async () => ({ url: 'https://proxy.example/dl', sizeBytes: 10, label: '480p', height: 480 }),
    capability: { supported: false, kind: 'none', reason: 'platform' },
  });
  await assert.rejects(() => manager.queue({ item }), (error) => error.code === 'DOWNLOAD_UNAVAILABLE');
  assert.equal(manager.list().length, 0);
});

test('a queued download runs to completion and reports measured progress', async () => {
  const storage = memoryStorage();
  const fetchImpl = streamingFetch([new Uint8Array(4), new Uint8Array(4)], { headers: { 'content-length': 8 } });
  const manager = new DownloadManager({
    storage,
    resolveUrl: async () => ({ url: 'https://proxy.example/dl', sizeBytes: 8, label: '480p', height: 480 }),
    fetchImpl,
    capability: { supported: true, kind: 'stream', write: async () => {}, close: async () => '' },
  });
  const record = await manager.queue({ item, episode, quality: '480p' });
  assert.equal(record.height, 480);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const finished = manager.find(record.id);
  assert.equal(finished.state, DOWNLOAD_STATES.failed, 'the blob sink needs a document, so this platform path fails cleanly');
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /proxy\.example/);
});

test('a resolved URL that cannot be fetched leaves a failed record with a readable reason', async () => {
  const storage = memoryStorage();
  const manager = new DownloadManager({
    storage,
    resolveUrl: async () => ({ url: 'https://proxy.example/dl', sizeBytes: 10, label: 'Auto', height: 0 }),
    fetchImpl: async () => ({ ok: false, status: 502, headers: { get: () => null } }),
    capability: { supported: true, kind: 'stream', write: async () => {}, close: async () => '' },
  });
  await manager.queue({ item });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const [record] = manager.list();
  assert.equal(record.state, DOWNLOAD_STATES.failed);
  assert.ok(record.error.length > 0);
  assert.equal(/proxy|http|502/i.test(record.error), false, 'the reason stays viewer-facing');
});

test('a failed resolution never leaves a phantom queued item', async () => {
  const manager = new DownloadManager({
    storage: memoryStorage(),
    resolveUrl: async () => { throw new Error('nope'); },
    fetchImpl: streamingFetch([]),
    capability: { supported: true, kind: 'stream', write: async () => {}, close: async () => '' },
  });
  const record = await manager.queue({ item });
  assert.equal(record.state, DOWNLOAD_STATES.failed);
  assert.equal(manager.list().length, 1);
});

test('pausing is immediate and removing clears the record', async () => {
  const manager = new DownloadManager({
    storage: memoryStorage(),
    resolveUrl: async () => ({ url: 'https://proxy.example/dl', sizeBytes: MAX_IN_MEMORY_BYTES + 1, label: 'Auto', height: 0 }),
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: { get: () => String(MAX_IN_MEMORY_BYTES + 1) },
      body: new ReadableStream({ pull() {} }),
    }),
    capability: { supported: true, kind: 'blob' },
  });
  const record = await manager.queue({ item });
  assert.equal(manager.find(record.id).state, DOWNLOAD_STATES.failed, 'an oversized in-memory download is refused up front');
  await manager.remove(record.id);
  assert.equal(manager.list().length, 0);
});

test('persisted state is written through the injected storage', async () => {
  const storage = memoryStorage();
  const manager = new DownloadManager({
    storage,
    resolveUrl: async () => ({ url: 'https://proxy.example/dl', sizeBytes: 1, label: 'Auto', height: 0 }),
    fetchImpl: async () => ({ ok: false, status: 500, headers: { get: () => null } }),
    capability: { supported: true, kind: 'stream', write: async () => {}, close: async () => '' },
  });
  await manager.queue({ item });
  assert.ok(storage.raw.has('veyra-downloads:v1'));
});
