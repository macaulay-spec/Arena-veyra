import React from 'react';
import { renderToString } from 'react-dom/server';
import App, {
  DetailScreen, DownloadsScreen, HistoryScreen, PlayerScreen, SearchScreen, SettingsScreen, TVHomeScreen, ContinueScreen, MyListScreen,
} from '../src/App.jsx';
import { contentReference, normalizeContent } from '../src/services/moviebox/normalize.js';

const noop = () => {};
const item = normalizeContent({
  subjectId: '6391474290696802080',
  subjectType: 1,
  title: 'Inception',
  detailPath: 'inception-e1BOR6f19C7',
  duration: 8880,
  genre: 'Action,Adventure,Sci-Fi',
  cover: { url: 'https://img.example/poster.jpg' },
  hasResource: true,
});
const series = normalizeContent({ subjectId: '3312401956190176080', subjectType: 2, title: 'The Expecting', detailPath: 'the-expecting-8wGanYPPGW3' });
const reference = contentReference(item);
const historyEntry = { id: `${item.id}::0:0`, content: reference, season: null, episode: null, label: '', position: 600, duration: 8880, percent: 6.7, completed: false, updatedAt: new Date().toISOString() };

const screens = {
  app: <App />,
  tvHome: <TVHomeScreen onGo={noop} onOpen={noop} onPlay={noop} onSearch={noop} onProfile={noop} featured={item} sections={[{ id: 's', title: 'Trending now', items: [item] }]} loading={false} error="" onRetry={noop} />,
  detailMovie: <DetailScreen item={item} onBack={noop} onPlay={noop} onToggleSaved={noop} isSaved={() => false} onDownload={noop} onOpen={noop} isTV={false} progressFor={() => undefined} />,
  detailSeries: <DetailScreen item={series} onBack={noop} onPlay={noop} onToggleSaved={noop} isSaved={() => false} onDownload={noop} onOpen={noop} isTV isTV={true} progressFor={() => undefined} />,
  playerMovie: <PlayerScreen content={item} episode={null} season={null} startPosition={420} onBack={noop} onProgress={noop} preferredLanguage="English" isTV={false} />,
  playerSeries: <PlayerScreen content={series} episode={{ apiSeason: 1, apiEpisode: 2, episodeNo: 2, number: 2, title: 'Episode 2' }} season={1} startPosition={0} onBack={noop} onProgress={noop} preferredLanguage="Français" isTV />,
  search: <SearchScreen onGo={noop} onOpen={noop} />,
  history: <HistoryScreen onGo={noop} entries={[historyEntry]} onClear={noop} onRemove={noop} onOpen={noop} onResume={noop} />,
  continue: <ContinueScreen onGo={noop} items={[{ id: historyEntry.id, content: item, percent: 6.7, label: '', remainingLabel: '138 min left' }]} onOpen={noop} onPlay={noop} />,
  downloads: <DownloadsScreen onGo={noop} entries={[
    { id: 'd1', content: reference, label: 'Season 1 · Episode 2', resolution: '1080p', state: 'starting', downloadUrl: '', startedAt: new Date().toISOString() },
    { id: 'd2', content: reference, state: 'unavailable', message: 'The provider’s download service did not respond within 20 seconds.', downloadUrl: '' },
    { id: 'd3', content: reference, state: 'ready', resolution: '720p', downloadUrl: 'https://api.zstlab.cyou/api/proxy-download?url=x' },
    { id: 'd4', content: reference, state: 'failed', message: 'HTTP_426' },
  ]} notice="Streaming is under maintenance right now." onRetry={noop} onSave={noop} onRemove={noop} onDismissNotice={noop} />,
  list: <MyListScreen onGo={noop} onOpen={noop} savedItems={[reference]} onRemove={noop} />,
  settingsDark: <SettingsScreen onGo={noop} settings={{ language: 'English', appearance: 'Dark' }} setSettings={noop} historyCount={2} onClearHistory={noop} />,
  settingsSystem: <SettingsScreen onGo={noop} settings={{ language: 'العربية', appearance: 'System' }} setSettings={noop} historyCount={0} onClearHistory={noop} />,
};

let failures = 0;
for (const [name, element] of Object.entries(screens)) {
  try {
    const html = renderToString(element);
    if (!html.length) throw new Error('empty output');
    if (/Playback unavailable/.test(html)) throw new Error('leftover "Playback unavailable" copy');
    console.log(`ok   ${name} (${html.length} chars)`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
if (failures) throw new Error(`${failures} screen(s) failed to render`);
console.log('Render smoke: all screens rendered');
