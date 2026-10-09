// One-off diagnostic (safe to delete): does 'Dark' resolve S1E1 media today?
import { zstProvider } from '../server/providers/zst.js';
import { normalizePagedPayload } from '../server/normalize.js';

const base = process.env.ZST_API_BASE_URL || 'https://zstlab.cyou/api';
const key = process.env.ZST_API_KEY;

const response = await fetch(
  `${base}/search?query=${encodeURIComponent('Dark')}&subjectType=2&page=0&perPage=5`,
  { headers: { 'x-api-key': key } },
);
const payload = await response.json();
const hits = normalizePagedPayload(payload.data).items;
console.log('Dark hits:', hits.map((hit) => `${hit.subjectId}:${hit.title}`).join(' | '));
const dark = hits.find((hit) => hit.type === 'series');
if (!dark) {
  console.log('no series hit for Dark');
  process.exit(0);
}
console.log('picked:', dark.title, dark.subjectId, dark.detailPath);

const mediaResponse = await fetch(
  `${base}/media?subjectId=${dark.subjectId}&detailPath=${dark.detailPath}&season=1&episode=1`,
  { headers: { 'x-api-key': key } },
);
const text = await mediaResponse.text();
console.log('media HTTP', mediaResponse.status, ':', text.slice(0, 400));
