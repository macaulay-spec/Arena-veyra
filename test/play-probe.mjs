import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5173';
const browser = await chromium.launch();
const page = await browser.newPage();

const apiCalls = [];
const byteRequests = [];
const consoleMsgs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleMsgs.push(`[${m.type()}] ${m.text().slice(0, 300)}`); });
page.on('pageerror', (e) => consoleMsgs.push(`[pageerror] ${String(e).slice(0, 500)}`));
page.on('response', (res) => {
  const u = res.url();
  if (u.includes('/api/veyra/')) apiCalls.push(`${res.status()} ${u.replace(BASE, '').slice(0, 100)}`);
  else if (u.includes('zstlab') || u.includes('hakunaymatata') || u.includes('.mp4')) byteRequests.push(`${res.status()} ${u.slice(0, 130)}`);
});
page.on('requestfailed', (req) => {
  const u = req.url();
  if (u.includes('zstlab') || u.includes('hakunaymatata') || u.includes('.mp4')) byteRequests.push(`FAILED(${req.failure()?.errorText}) ${u.slice(0, 130)}`);
});

await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(3000);
for (const label of ['Get started', 'Start watching', 'Continue', 'Enter', 'Explore']) {
  const b = page.locator(`button:has-text("${label}")`);
  if (await b.count()) { try { await b.first().click({ timeout: 1500 }); } catch {} break; }
}
await page.waitForTimeout(1000);

// Open search and look up a title the provider reports as playable.
await page.locator('button[aria-label="Search"]').first().click({ timeout: 8000 });
await page.waitForTimeout(800);
await page.locator('input[aria-label="Search movies and series"]').fill('Inception', { timeout: 8000 });
await page.waitForTimeout(3500);
console.log('RESULTS:', await page.evaluate(() => document.body.innerText.slice(0, 220).replace(/\n/g, ' | ')));

await page.locator('.search-result-play').first().click({ timeout: 8000 })
  .catch((e) => console.log('play click fail', e.message));

const snapshot = async (label) => {
  const s = await page.evaluate(() => {
    const v = document.querySelector('video');
    const err = document.querySelector('.player-error');
    return {
      videoSrc: v ? (v.src || '').slice(0, 140) : null,
      readyState: v ? v.readyState : null,
      networkState: v ? v.networkState : null,
      error: v && v.error ? { code: v.error.code, message: v.error.message } : null,
      currentTime: v ? v.currentTime : null,
      paused: v ? v.paused : null,
      errOverlay: err ? err.innerText.replace(/\n+/g, ' / ') : null,
    };
  });
  console.log(label, JSON.stringify(s));
};

await page.waitForTimeout(4000);
await snapshot('T+4s ');
await page.waitForTimeout(8000);
await snapshot('T+12s');
await page.waitForTimeout(8000);
await snapshot('T+20s');

console.log('CONSOLE', JSON.stringify(consoleMsgs.slice(0, 12), null, 1));
console.log('API', JSON.stringify(apiCalls.slice(-8), null, 1));
console.log('BYTES', JSON.stringify(byteRequests, null, 1));
await browser.close();
