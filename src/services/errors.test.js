// Client error vocabulary: which HTTP statuses are surfaced vs auto-retried.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ErrorCodes, codeForStatus, isRetryableStatus } from './errors.js';

test('429 surfaces as RATE_LIMITED and is never auto-retried', () => {
  assert.equal(codeForStatus(429), ErrorCodes.RATE_LIMITED);
  assert.equal(isRetryableStatus(429), false,
    'retrying a rate limit after milliseconds only amplifies it');
});

test('transient server failures stay retryable', () => {
  for (const status of [408, 425, 500, 502, 503, 504]) {
    assert.equal(isRetryableStatus(status), true, `status ${status} should be retryable`);
  }
  assert.equal(isRetryableStatus(404), false);
  assert.equal(isRetryableStatus(400), false);
});
