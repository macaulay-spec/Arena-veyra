import test from 'node:test';
import assert from 'node:assert/strict';
import { copy, friendlyError, metaLine } from './copy.js';

const FORBIDDEN = /api|moviebox|zst|endpoint|http|json|provider|proxy|subjectid|credential|backend/i;

test('every mapped error reads like product copy, never like a log line', () => {
  const cases = [
    { code: 'TIMEOUT' },
    { code: 'NETWORK_ERROR' },
    { code: 'RATE_LIMITED' },
    { code: 'NOT_CONFIGURED' },
    { code: 'CATALOG_UNAVAILABLE' },
    { code: 'SERVER_ERROR' },
    { code: 'INVALID_RESPONSE' },
    { code: 'NOT_FOUND' },
    { code: 'PLAYBACK_UNAVAILABLE' },
    { code: 'SUBTITLES_UNAVAILABLE' },
    { code: 'DOWNLOAD_UNAVAILABLE' },
    { code: 'ANYTHING_ELSE', message: 'the upstream service returned HTTP 502 while calling an internal route' },
  ];
  for (const error of cases) {
    const message = friendlyError(error, copy.errors.details);
    assert.ok(message.length > 0, `${error.code} should produce a message`);
    assert.equal(FORBIDDEN.test(message), false, `leaked technical detail: ${message}`);
    assert.equal(message.includes('502'), false);
  }
});

test('cancelled requests stay silent instead of flashing an error', () => {
  assert.equal(friendlyError({ name: 'AbortError' }), '');
  assert.equal(friendlyError({ code: 'ABORTED' }), '');
});

test('unknown errors fall back to the screen-specific sentence', () => {
  assert.equal(friendlyError({ code: 'SOMETHING_NEW' }, copy.errors.search), copy.errors.search);
  assert.equal(friendlyError(undefined, copy.errors.home), copy.errors.home);
});

test('card metadata stays short and skips empty values', () => {
  assert.equal(metaLine({ year: '2026', type: 'series', genres: ['Drama', 'Thriller'] }), '2026 · Series · Drama');
  assert.equal(metaLine({ type: 'movie' }), 'Film');
  assert.equal(metaLine(null), '');
});
