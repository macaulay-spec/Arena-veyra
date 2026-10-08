/**
 * Player DOM check.
 *
 * Mounts the real PlayerScreen in a DOM, with the real ZST client fed by a
 * stubbed fetch that returns a genuine /api/media payload, and asserts the
 * contract that broke once already:
 *
 *   1. the <video> element carries the quality's streamUrl (never an empty src),
 *   2. the src is the provider proxy link, never the raw CDN url,
 *   3. the status label reports BUFFERING — not PLAYING — while the element has
 *      no frames, so a media response can never masquerade as playback,
 *   4. the provider duration is labelled as an estimate until metadata arrives,
 *   5. a title with no playable source shows NO SOURCE and keeps src empty.
 *
 * No browser and no live API are needed.
 */
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createServer } from 'vite';

const RAW_360 = 'https://cdn.example/360.mp4?sign=a';
const RAW_1080 = 'https://cdn.example/1080.mp4?sign=b';
const STREAM_360 = `https://api.zstlab.cyou/api/proxy?url=${encodeURIComponent(RAW_360)}`;
const STREAM_1080 = `https://api.zstlab.cyou/api/proxy?url=${encodeURIComponent(RAW_1080)}`;

const MEDIA_PAYLOAD = {
  downloads: {
    code: 0,
    message: 'ok',
    data: {
      downloads: [
        { id: '2', url: RAW_1080, resolution: 1080, size: '2414667149', streamUrl: STREAM_1080, downloadUrl: `https://api.zstlab.cyou/api/proxy-download?url=${encodeURIComponent(RAW_1080)}` },
        { id: '1', url: RAW_360, resolution: 360, size: '777303372', streamUrl: STREAM_360, downloadUrl: `https://api.zstlab.cyou/api/proxy-download?url=${encodeURIComponent(RAW_360)}` },
      ],
      captions: [],
      hasResource: true,
    },
  },
  stream: {
    code: 0,
    message: 'ok',
    data: { streams: [{ format: 'MP4', url: RAW_1080, resolutions: '1080', duration: 8888, codecName: 'h264' }], dash: [], hls: [], hasResource: true },
  },
};

const EMPTY_PAYLOAD = {
  downloads: { code: 0, message: 'ok', data: { downloads: [], captions: [], hasResource: false } },
  stream: { code: 0, message: 'ok', data: { streams: [], dash: [], hls: [], hasResource: false } },
};

const INCEPTION = {
  id: 'moviebox:6391474290696802080',
  provider: 'moviebox',
  providerItemId: '6391474290696802080',
  detailPath: 'inception-e1BOR6f19C7',
  title: 'Inception',
  type: 'movie',
  poster: 'https://images.example/inception.jpg',
};

/* ---------------- DOM environment ---------------- */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://veyra.test/',
  pretendToBeVisual: true,
});

const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
// Node 22 defines a getter-only global `navigator`, so define over it.
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true, writable: true });
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.MediaError = window.MediaError;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
}
globalThis.matchMedia = window.matchMedia;

/** Serve the stubbed provider responses the real client will parse. */
let mediaPayload = MEDIA_PAYLOAD;
const requestedUrls = [];
globalThis.fetch = async (url) => {
  requestedUrls.push(String(url));
  const body = String(url).includes('/api/media') ? mediaPayload : { subject: INCEPTION, resource: { seasons: [] } };
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    json: async () => ({ status: true, statusCode: 200, data: body }),
    text: async () => JSON.stringify(body),
  };
};

/* ---------------- load the real app modules ---------------- */

const server = await createServer({ logLevel: 'error', server: { middlewareMode: true }, appType: 'custom' });

const failures = [];
const check = (label, fn) => {
  try {
    fn();
    console.log(`ok  - ${label}`);
  } catch (error) {
    failures.push(`${label}: ${error.message}`);
    console.log(`FAIL - ${label}: ${error.message}`);
  }
};

try {
  const [{ PlayerScreen }, React, { createRoot }] = await Promise.all([
    server.ssrLoadModule('/src/App.jsx'),
    import('react'),
    import('react-dom/client'),
  ]);
  const { act } = React;

  const mounted = [];

  const mount = async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    mounted.push(root);
    // Let the media request resolve and every effect settle inside act(), so
    // the assertions see the state a browser would show.
    await act(async () => {
      root.render(React.createElement(PlayerScreen, {
        content: INCEPTION,
        startPosition: 0,
        onBack() {},
        onProgress() {},
        preferredLanguage: 'English',
        isTV: false,
      }));
      for (let tick = 0; tick < 8; tick += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    });
    return host;
  };

  /* ---------------- scenario 1: the provider returns qualities ---------------- */

  const host = await mount();
  const video = host.querySelector('video');
  const src = video?.getAttribute('src') || '';
  const status = (host.querySelector('.player-status')?.textContent || '').trim();

  check('the player renders a <video> element', () => {
    assert.ok(video, 'no <video> element was rendered');
  });

  check('the player requests /api/media from the provider', () => {
    assert.ok(requestedUrls.some((url) => url.includes('/api/media')), `no /api/media request was made (saw ${requestedUrls.join(', ') || 'nothing'})`);
  });

  check('the video element is bound to the streamUrl (never an empty src)', () => {
    assert.notEqual(src, '', 'the <video> element has no src, so no media can ever play');
    assert.ok([STREAM_360, STREAM_1080].includes(src), `unexpected src: ${src}`);
  });

  check('playback uses the provider proxy link, never the raw CDN url', () => {
    assert.match(src, /^https:\/\/api\.zstlab\.cyou\/api\/proxy\?url=/);
    // The CDN url may only appear percent-encoded inside the proxy query; it
    // must never be the player's own source.
    assert.ok(!src.startsWith('https://cdn.example'), 'the raw CDN url was bound to the player');
    assert.ok(!/^https:\/\/cdn\.example/.test(video?.getAttribute('src') || ''));
  });

  check('a media response alone never reports PLAYING', () => {
    assert.notEqual(status.toUpperCase(), 'PLAYING', `status was "${status}" while the element had no frames (readyState 0)`);
    assert.equal(status.toUpperCase(), 'BUFFERING');
  });

  check('the provider duration is shown as an estimate until metadata arrives', () => {
    const times = [...host.querySelectorAll('.time-row span')].map((node) => node.textContent.trim());
    assert.ok(times.includes('~2h 28m') || times.some((value) => value.startsWith('~')), `duration was not labelled as an estimate: ${JSON.stringify(times)}`);
  });

  /* ---------------- scenario 2: the title has no source ---------------- */

  mediaPayload = EMPTY_PAYLOAD;
  const emptyHost = await mount();
  const emptyVideo = emptyHost.querySelector('video');
  const emptyStatus = (emptyHost.querySelector('.player-status')?.textContent || '').trim();
  const emptySrc = emptyVideo?.getAttribute('src') || '';

  check('a title without a playable source keeps src empty and says NO SOURCE', () => {
    assert.equal(emptySrc, '', `src should stay empty, got ${emptySrc}`);
    assert.equal(emptyStatus.toUpperCase(), 'NO SOURCE');
  });

  check('no fallback content is invented when the provider has nothing', () => {
    assert.equal(emptyHost.querySelectorAll('video').length, 1);
    assert.ok(!/inception\.jpg/.test(emptySrc));
  });
  for (const root of mounted) await act(async () => { root.unmount(); });
} finally {
  await server.close();
  // Tear the DOM down so jsdom's player timers cannot hold the process open.
  window.close();
}

if (failures.length) {
  console.error(`\nPlayer DOM check failed:\n${failures.map((line) => ` - ${line}`).join('\n')}`);
  process.exit(1);
}
console.log('\nPlayer DOM check: the stream URL is bound to the video element and status follows the element.');
// jsdom keeps the player's 20 s stall watchdog timers alive even after close();
// this is a check script, so exit explicitly once the assertions are reported.
process.exit(0);
