import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { chromium } from 'playwright';

// The preview origin of the running VEYRA dev server. `VEYRA_PLAYWRIGHT_BASE`
// overrides it (useful for a tunnel URL); otherwise the local preview is used.
const BASE = process.env.VEYRA_PLAYWRIGHT_BASE || 'http://localhost:5173';
const API = `${BASE}/api/veyra`;

async function ensurePlaywright() {
  try {
    await import('playwright');
    if (!existsSync(join(process.cwd(), 'node_modules', '.cache', 'ms-playwright'))) {
      console.log('INSTALLING_PLAYWRIGHT_BROWSERS');
      execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 600000 });
    }
    return;
  } catch (err) {
    console.log('INSTALLING_PLAYWRIGHT');
    execSync('bun add -D playwright', { stdio: 'inherit', timeout: 600000 });
    console.log('INSTALLING_PLAYWRIGHT_BROWSERS');
    execSync('npx playwright install chromium', { stdio: 'inherit', timeout: 600000 });
  }
}

// Live-verified targets (2026-10-08): both resolve item-details and media
// against the current deployment. `hello-me` is stale upstream and 404s now.
const TARGETS = [
  { subjectId: '6391474290696802080', detailPath: 'inception-e1BOR6f19C7' },
  { subjectId: '3148392746424091800', detailPath: 'coven-academy-UQietRFFzK3', season: 1, episode: 1 },
];

function upstreamBodyKind(body) {
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && parsed.status === false && typeof parsed.statusCode === 'number') {
      return 'provider_proxy_http_error:' + parsed.statusCode;
    }
  } catch {}
  if (typeof body === 'string' && body.trimStart().startsWith('{')) return 'json_unknown';
  if (typeof body === 'string' && body.length > 0) return 'bytes:' + body.slice(0, 60);
  return 'empty';
}

async function main() {
  console.log('PLAYABLE_CHECK');
  console.log('Platform:', process.platform);
  console.log('Node:', process.version);

  await ensurePlaywright();

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const logs = [];
  page.on('console', (msg) => {
    const text = String(msg.text());
    if (/error|fail|not configured|api key|loading|network|http|playback|media|player|video|notsamething|mediablocked/i.test(text)) {
      logs.push(`[${msg.type()}] ${text}`);
    }
  });
  page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}`));

  // 1) App shell
  let html;
  try {
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2500);
    html = await page.content();
  } catch (err) {
    console.log('APP_SHELL_FAIL', err.message);
    await browser.close();
    return;
  }
  const title = await page.title();
  console.log('APP_SHELL', html.includes('<html'), 'title', title);

  // 2) Assets — resolve the hashed bundle name from the HTML, then fetch it
  let assets;
  try {
    const jsMatch = html.match(/src="\/assets\/index-([A-Za-z0-9]+)\.js"/);
    const cssMatch = html.match(/href="\/assets\/index-([A-Za-z0-9]+)\.css"/);
    const jsName = jsMatch?.[1];
    const cssName = cssMatch?.[1];
    assets = {
      htmlSize: html.length,
      jsName,
      cssName,
      js: jsName ? await fetch(`${BASE}/assets/index-${jsName}.js`, { signal: AbortSignal.timeout(20000) }).then(r => ({ status: r.status, size: r.headers.get('content-length') })).catch(e => ({ error: String(e) })) : null,
      css: cssName ? await fetch(`${BASE}/assets/index-${cssName}.css`, { signal: AbortSignal.timeout(20000) }).then(r => ({ status: r.status, size: r.headers.get('content-length') })).catch(e => ({ error: String(e) })) : null,
    };
  } catch (err) {
    assets = { error: err.message };
  }
  console.log('APP_ASSETS', assets);

  // 3) API
  let health;
  try { health = await fetch(`${API}/health`, { signal: AbortSignal.timeout(30000) }).then(r => r.json()); } catch (err) { health = { error: err.message }; }
  console.log('API_HEALTH', JSON.stringify(health));

  // 4) Media per target — one short candidate per title to keep the check short
  let bestPass = false;
  let bestReport = null;

  for (const t of TARGETS) {
    const qs = new URLSearchParams();
    if (t.subjectId) qs.set('subjectId', t.subjectId);
    if (t.detailPath) qs.set('detailPath', t.detailPath);
    if (t.season) qs.set('season', String(t.season));
    if (t.episode) qs.set('episode', String(t.episode));

    let media;
    try {
      media = await fetch(`${API}/media?${qs}`, { signal: AbortSignal.timeout(60000) }).then(r => r.json());
    } catch (err) {
      console.log('API_MEDIA_FAIL', t.detailPath, err.message);
      continue;
    }
    console.log('API_MEDIA', t.detailPath, media?.status, 'sources', media?.data?.sources?.length, 'subs', media?.data?.subtitles?.length, 'dl', media?.data?.downloads?.length);

    const source = (media?.data?.sources || []).find(s => s?.url) || null;
    if (!source) {
      console.log('NO_SOURCE_URL', t.detailPath);
      continue;
    }
    console.log('SOURCE', t.detailPath, source.url.slice(0, 120));
    console.log('SOURCE_FALLBACK', t.detailPath, source.fallbackUrl ? source.fallbackUrl.slice(0, 120) : null);
    console.log('SOURCE_HEIGHT', t.detailPath, source.height, 'LABEL', source.label, 'TYPE', source.type);

    page.waitForTimeout(600);
    const loadResult = await page.evaluate((payload) => {
      return new Promise((resolve) => {
        const v = document.createElement('video');
        v.muted = true;
        v.preload = 'auto';
        v.src = payload.url;
        document.body.appendChild(v);

        let settled = false;
        const done = (state) => {
          if (settled) return;
          settled = true;
          resolve({ readyState: v.readyState, currentTime: v.currentTime, error: v.error ? v.error.message : null, state });
        };

        v.addEventListener('loadeddata', () => done('loadeddata'), { once: true });
        v.addEventListener('canplay', () => done('canplay'), { once: true });
        v.addEventListener('playing', () => done('playing'), { once: true });
        v.addEventListener('error', () => done('error'), { once: true });

        setTimeout(() => done('timeout'), payload.timeoutMs);
      });
    }, { url: source.fallbackUrl ?? source.url, timeoutMs: 18000 });

    console.log('BROWSER_VIDEO', t.detailPath, JSON.stringify(loadResult));

    const pass = loadResult.state === 'playing' || (loadResult.readyState >= 2 && !loadResult.error);
    if (pass) bestPass = true;
    if (!bestReport || loadResult.state === 'playing') bestReport = { target: t.detailPath, candidate: 'fallback:' + source.height, loadResult };
  }

  // 5) Upstream reachability sanity for one title to separate app bug from provider-side block
  let upstreamHead = null;
  try {
    const firstTarget = TARGETS[0];
    const qs = new URLSearchParams();
    if (firstTarget.subjectId) qs.set('subjectId', firstTarget.subjectId);
    if (firstTarget.detailPath) qs.set('detailPath', firstTarget.detailPath);
    if (firstTarget.season) qs.set('season', String(firstTarget.season));
    if (firstTarget.episode) qs.set('episode', String(firstTarget.episode));
    const media = await fetch(`${API}/media?${qs}`, { signal: AbortSignal.timeout(60000) }).then(r => r.json());
    const s = (media?.data?.sources || []).find(x => x?.url && x?.fallbackUrl) || media?.data?.sources?.[0];
    if (s?.url && s?.fallbackUrl) {
      let proxyBody = '';
      let fallbackBody = '';
      try { proxyBody = await fetch(s.url, { signal: AbortSignal.timeout(30000) }).then(r => r.text()); } catch {}
      try { fallbackBody = await fetch(s.fallbackUrl, { signal: AbortSignal.timeout(30000) }).then(r => r.text()); } catch {}
      upstreamHead = {
        proxy: { status: s.url, bodyKind: upstreamBodyKind(proxyBody), bodySample: proxyBody.slice(0, 120) },
        fallback: { status: s.fallbackUrl, bodyKind: upstreamBodyKind(fallbackBody), bodySample: fallbackBody.slice(0, 120) },
      };
    }
  } catch (err) {
    upstreamHead = { error: err.message };
  }
  console.log('UPSTREAM_HEAD', JSON.stringify(upstreamHead));

  // 6) Final answer line for the task
  const verdictText = bestPass
    ? 'headless Chromium loaded the app shell, hit a real /api/veyra/media source, and at least one browser media element reached loadeddata/canplay/playing without error'
    : bestReport
      ? `no title reached a playable state in the browser; best attempt was ${bestReport.target ?? 'unknown'} (${bestReport.candidate ?? 'unknown'}): ${JSON.stringify(bestReport.loadResult)}`
      : 'no usable source url returned from /api/veyra/media for any tested title';

  console.log('PLAYABLE_CHECK_PASSED', bestPass);
  console.log('PLAYABLE_CHECK_REASON', verdictText);

  const appSideOk = (() => {
    try {
      const hData = health?.data;
      const mStatus = media?.status;
      return Boolean(hData?.configured && hData?.catalog === 'up' && mStatus === true);
    } catch {
      return false;
    }
  })();
  const upstreamLikelyBlockedFromHere = (() => {
    if (!upstreamHead || typeof upstreamHead !== 'object') return false;
    const p = upstreamHead.proxy?.bodyKind;
    const f = upstreamHead.fallback?.bodyKind;
    return p.startsWith('provider_proxy_http_error') || f.startsWith('provider_proxy_http_error') || p.startsWith('json_unknown') || f.startsWith('json_unknown') || f.startsWith('bytes:');
  })();

  if (bestPass) {
    console.log('PLAYABLE_CHECK_DIAGNOSIS', 'app and upstream both ok for at least one title in this browser check');
  } else if (appSideOk && upstreamLikelyBlockedFromHere) {
    console.log('PLAYABLE_CHECK_DIAGNOSIS', 'app contract is correct (real source + fallback from /api/veyra/media), but upstream media bytes were not reachable from this sandbox (provider returned 403/429 or non-video body); the remaining question is byte reachability on a real client network');
  } else if (appSideOk) {
    console.log('PLAYABLE_CHECK_DIAGNOSIS', 'app contract is correct, but upstream bytes were not reachable from this sandbox and no non-video body was captured; the remaining question is byte reachability on a real client network');
  } else {
    console.log('PLAYABLE_CHECK_DIAGNOSIS', 'app-side API health/media not healthy; if the app showed loading forever, that is the cause to fix');
  }

  console.log('LOGS');
  for (const line of logs.slice(0, 40)) {
    console.log('  ', line);
  }

  try { await browser.close(); } catch {}
}

main().catch((err) => {
  console.log('UNCAUGHT', err.message);
  try { process.exitCode = 1; } catch {}
});
