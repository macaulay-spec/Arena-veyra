// One-off diagnostic (safe to delete): find a TV series whose media endpoint
// actually resolves with real streams — not one that only echoes 0 counts.
import { zstProvider } from '../server/providers/zst.js';
import { normalizeMediaPayload, normalizePagedPayload, normalizeSeasons } from '../server/normalize.js';

const candidates = ['Dark', 'Breaking Bad', 'Prison Break', 'The Boys', 'Money Heist'];

for (const query of candidates) {
  let hits = [];
  try {
    const searchPayload = await zstProvider.search({ query, subjectType: '2', page: 0, perPage: 4 });
    hits = normalizePagedPayload(searchPayload).items;
  } catch (error) {
    console.log(`${query}: search failed (${error?.code || 'unknown'})`);
    continue;
  }
  const series = hits.find((hit) => hit.type === 'series' && hit.subjectId);
  if (!series) continue;

  let detailsPayload;
  try {
    detailsPayload = await zstProvider.getItemDetails({ subjectId: series.subjectId, detailPath: series.detailPath });
  } catch (error) {
    console.log(`${series.title}: details failed (${error?.code || 'unknown'})`);
    continue;
  }
  const seasons = normalizeSeasons(detailsPayload);
  if (!seasons.length) {
    console.log(`${series.title}: no seasons on this deployment`);
    continue;
  }

  const season = seasons[0];
  let mediaPayload;
  try {
    mediaPayload = await zstProvider.getMedia({ subjectId: series.subjectId, detailPath: series.detailPath, season: season.season, episode: 1 });
  } catch (error) {
    console.log(`${series.title}: media failed (${error?.code || 'unknown'})`);
    continue;
  }
  const normalized = normalizeMediaPayload(mediaPayload);
  console.log(
    `${series.title} (S${season.season}E1) → sources=${normalized.sources.length}, subs=${normalized.subtitles.length}, expiresAt=${normalized.expiresAt ?? 'none'}`,
  );
  if (normalized.sources.length) {
    console.log('  heights:', normalized.sources.map((source) => source.label).join(','));
    process.exit(0);
  }
}
console.log('no series with a playable S1E1 was found on this deployment');
