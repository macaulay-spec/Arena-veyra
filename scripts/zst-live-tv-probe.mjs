// One-off diagnostic (safe to delete): find TV series that both resolve
// item-details AND return real S1E1 streams on the current deployment.
import { zstProvider } from '../server/providers/zst.js';
import {
  normalizeHomepage,
  normalizeMediaPayload,
} from '../server/normalize.js';

const homePayload = await zstProvider.getHomepage();
const { rails } = normalizeHomepage(homePayload);

const candidates = [];
for (const rail of rails) {
  for (const item of rail.items) {
    if (item.type === 'series' && item.subjectId && item.hasResource) {
      candidates.push(item);
    }
  }
}

console.log(`found ${candidates.length} series candidates from live home rails`);

for (const candidate of candidates.slice(0, 12)) {
  let details;
  try {
    details = await zstProvider.getItemDetails({ subjectId: candidate.subjectId, detailPath: candidate.detailPath });
  } catch (error) {
    console.log(`${candidate.title}: details failed (${error?.code || 'unknown'})`);
    continue;
  }

  let media;
  try {
    media = await zstProvider.getMedia({ subjectId: candidate.subjectId, detailPath: candidate.detailPath, season: 1, episode: 1 });
  } catch (error) {
    console.log(`${candidate.title}: media failed (${error?.code || 'unknown'})`);
    continue;
  }

  const normalized = normalizeMediaPayload(media);
  const hasStreams = normalized.sources.length > 0;
  console.log(
    `${candidate.title}: details OK, media ${hasStreams ? 'OK' : 'EMPTY'} — sources=${normalized.sources.length}, subs=${normalized.subtitles.length}`,
  );
  if (hasStreams) {
    console.log('  heights:', normalized.sources.map((source) => source.label).join(', '));
    process.exit(0);
  }
}

console.log('no series with playable S1E1 was found on this deployment');
