import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();

const apiCalls = [];
const mediaRequests = [];
const consoleMsgs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${String(e).slice(0, 500)}`));
page.on('response', async (res) => {
  const u = res.url();
  if (u.includes('/api/veyra/')) {
    apiCalls.push({ url: u.replace(BASE, '').slice(0, 110), status: res.status() });
  } else if (u.includes('zstlab') || u.includes('hakunaymatata')) {
    mediaRequests.push({ url: u.slice(0, 110), status: res.status() });
  }
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);

// Dismiss welcome screen if present
for (const label of ['Get started', 'Start watching', 'Continue', 'Enter', 'Explore']) {
  const b = page.locator(`button:has-text("${label}")`);
  if (await b.count()) { try { await b.first().click({ timeout: 1500 }); } catch {} break; }
}
await page.waitForTimeout(1500);

const posters = page.locator('button.poster-card');
await posters.first().waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
console.log('POSTERS', await posters.count());
await posters.first().click({ timeout: 10000 }).catch((e) => console.log('poster click fail', e.message));
await page.waitForTimeout(3500);
console.log('AFTER POSTER:', (await page.evaluate(() => document.body.innerText.slice(0, 200))).replace(/\n/g, ' | '));
const cast = await page.evaluate(() => ({
  count: document.querySelectorAll('.cast-person').length,
  first: document.querySelector('.cast-person')?.innerText.replace(/\n/g, ' / ') || null,
}));
console.log('CAST', JSON.stringify(cast));

const watch = page.locator('button:has-text("Watch now"), button:has-text("Resume"), button:has-text("Play")').first();
await watch.waitFor({ state: 'visible', timeout: 15000 }).catch((e) => console.log('watch wait fail', e.message.slice(0, 80)));
console.log('WATCH btns', await watch.count().catch(() => -1));
await watch.click({ timeout: 8000 }).catch((e) => console.log('watch click fail', e.message));

await page.waitForTimeout(9000);

const state = await page.evaluate(() => {
  const v = document.querySelector('video');
  const err = document.querySelector('.player-error');
  return {
    title: document.title,
    hasVideo: Boolean(v),
    videoSrc: v ? (v.src || '').slice(0, 130) : null,
    readyState: v ? v.readyState : null,
    networkState: v ? v.networkState : null,
    error: v && v.error ? { code: v.error.code, message: v.error.message } : null,
    currentTime: v ? v.currentTime : null,
    playerErrorText: err ? err.innerText : null,
    bodySnippet: document.body.innerText.slice(0, 300),
  };
});

console.log('STATE', JSON.stringify(state, null, 2));
console.log('CONSOLE', JSON.stringify(consoleMsgs, null, 2));
console.log('API_CALLS', JSON.stringify(apiCalls, null, 2));
console.log('MEDIA_REQUESTS', JSON.stringify(mediaRequests, null, 2));
await browser.close();
