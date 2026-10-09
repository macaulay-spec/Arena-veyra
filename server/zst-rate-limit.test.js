// Rate-limit behaviour of the ZST provider adapter.
//
// A provider 429 must never be retried in-process, and once it happens the
// cooldown makes every follow-up call fail fast without touching the network.

import test from 'node:test';
import assert from 'node:assert/strict';
import { ProviderError, resetRateLimitCooldown, zstProvider } from './providers/zst.js';

const json = (body, init = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init });
const rateLimited = (headers = {}) =>
  new Response('<html>rate limited</html>', { status: 429, headers });

function withProviderEnv(run) {
  const previousKey = process.env.ZST_API_KEY;
  const previousCooldown = process.env.ZST_RATE_LIMIT_COOLDOWN_MS;
  process.env.ZST_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  const calls = { count: 0 };
  const stub = (handler) => {
    globalThis.fetch = async () => {
      calls.count += 1;
      return handler();
    };
  };
  const restore = () => {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.ZST_API_KEY;
    else process.env.ZST_API_KEY = previousKey;
    if (previousCooldown === undefined) delete process.env.ZST_RATE_LIMIT_COOLDOWN_MS;
    else process.env.ZST_RATE_LIMIT_COOLDOWN_MS = previousCooldown;
    resetRateLimitCooldown();
  };
  return { calls, stub, restore, run };
}

test('a 429 is not retried inside the provider', async () => {
  const ctx = withProviderEnv();
  resetRateLimitCooldown();
  ctx.stub(() => rateLimited());
  try {
    await assert.rejects(
      () => zstProvider.getTrending({}),
      (error) => error instanceof ProviderError && error.code === 'PROVIDER_RATE_LIMITED' && error.status === 429,
    );
    assert.equal(ctx.calls.count, 1, 'one 429 must produce exactly one upstream request');
  } finally {
    ctx.restore();
  }
});

test('during the cooldown follow-up calls fail fast without a network call', async () => {
  const ctx = withProviderEnv();
  resetRateLimitCooldown();
  ctx.stub(() => rateLimited());
  try {
    await assert.rejects(() => zstProvider.getHot(), (error) => error.code === 'PROVIDER_RATE_LIMITED');
    assert.equal(ctx.calls.count, 1);

    await assert.rejects(() => zstProvider.getPopularSearches(), (error) => error.code === 'PROVIDER_RATE_LIMITED');
    await assert.rejects(() => zstProvider.getTrending({}), (error) => error.code === 'PROVIDER_RATE_LIMITED');
    assert.equal(ctx.calls.count, 1, 'the cooldown must absorb calls without new upstream requests');
  } finally {
    ctx.restore();
  }
});

test('Retry-After decides how long the cooldown lasts', async () => {
  const ctx = withProviderEnv();
  resetRateLimitCooldown();
  delete process.env.ZST_RATE_LIMIT_COOLDOWN_MS;
  ctx.stub(() => rateLimited({ 'Retry-After': '0.05' }));
  try {
    await assert.rejects(() => zstProvider.getHot(), (error) => error.code === 'PROVIDER_RATE_LIMITED');
    assert.equal(ctx.calls.count, 1);

    // Still inside the 50ms window: fail fast.
    await assert.rejects(() => zstProvider.getHot(), (error) => error.code === 'PROVIDER_RATE_LIMITED');
    assert.equal(ctx.calls.count, 1);

    // After the window the circuit closes again.
    await new Promise((resolve) => setTimeout(resolve, 80));
    ctx.stub(() => json({ status: true, data: { ok: true } }));
    await zstProvider.getHot();
    assert.equal(ctx.calls.count, 2, 'the circuit must reopen once Retry-After has passed');
  } finally {
    ctx.restore();
  }
});

test('ZST_RATE_LIMIT_COOLDOWN_MS=0 disables the cooldown', async () => {
  const ctx = withProviderEnv();
  resetRateLimitCooldown();
  process.env.ZST_RATE_LIMIT_COOLDOWN_MS = '0';
  try {
    ctx.stub(() => rateLimited());
    await assert.rejects(() => zstProvider.getHot(), (error) => error.code === 'PROVIDER_RATE_LIMITED');
    assert.equal(ctx.calls.count, 1, 'the 429 itself is still not retried in-process');

    ctx.stub(() => json({ status: true, data: { ok: true } }));
    const payload = await zstProvider.getHot();
    assert.equal(ctx.calls.count, 2, 'with the cooldown disabled the next call must reach the provider');
    assert.equal(payload.ok, true);
  } finally {
    ctx.restore();
  }
});
