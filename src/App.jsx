import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Captions,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudOff,
  Compass,
  Download,
  FastForward,
  Film,
  Gauge,
  HardDrive,
  Heart,
  History,
  Languages,
  Loader2,
  Moon,
  MonitorPlay,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Rewind,
  Search,
  Settings,
  Sparkles,
  Star,
  Trash2,
  Tv,
  UserRound,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  BottomNav,
  Brand,
  ContentRail,
  EmptyState,
  ErrorState,
  PageTitle,
  PosterCard,
  ProgressBar,
  SearchEmpty,
  SkeletonRows,
  TopBar,
  VeyraMark,
} from './components';
import { genres } from './data';
import {
  getMovieBoxApiBaseUrl,
  isMovieBoxConfigured,
  movieBoxClient,
  probeDownloadAvailability,
  probeMediaUrl,
} from './services/moviebox/client';
import {
  contentReference,
  extractContentList,
  extractContentSections,
  extractNotice,
  extractSearchPage,
  extractSuggestions,
  formatDuration,
  normalizeDetail,
  normalizeMedia,
  normalizeSavedReference,
} from './services/moviebox/normalize';
import { loadSubtitleTrack } from './services/moviebox/subtitles';
import './styles.css';

const LIST_KEY = 'veyra-list:v2';
const HISTORY_KEY = 'veyra-history:v2';
const SETTINGS_KEY = 'veyra-settings:v2';
const DOWNLOADS_KEY = 'veyra-downloads:v1';

const DEFAULT_SETTINGS = { language: 'English', appearance: 'Dark' };
const LANGUAGE_CODES = { English: 'en', Español: 'es', Français: 'fr', العربية: 'ar' };

const CONTINUE_MIN_PERCENT = 2;
const CONTINUE_MAX_PERCENT = 95;
const HISTORY_LIMIT = 80;
const PLAYER_STALL_TIMEOUT_MS = 20_000;
const DOWNLOAD_TIMEOUT_MS = 20_000;

function readStore(key, fallback) {
  if (typeof window === 'undefined') return fallback;
  try {
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function writeStore(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browsing or under quota pressure.
  }
}

function readSavedReferences() {
  const stored = readStore(LIST_KEY, []);
  if (!Array.isArray(stored)) return [];
  return uniqueItems(stored.map(normalizeSavedReference).filter(Boolean));
}

function readHistory() {
  const stored = readStore(HISTORY_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry) => entry?.id && entry?.content?.providerItemId || entry?.content?.detailPath);
}

function readDownloads() {
  const stored = readStore(DOWNLOADS_KEY, []);
  if (!Array.isArray(stored)) return [];
  return stored.filter((entry) => entry?.id && entry?.content);
}

function readSettings() {
  const stored = readStore(SETTINGS_KEY, {});
  return {
    ...DEFAULT_SETTINGS,
    language: typeof stored?.language === 'string' ? stored.language : DEFAULT_SETTINGS.language,
    appearance: ['Dark', 'System'].includes(stored?.appearance) ? stored.appearance : DEFAULT_SETTINGS.appearance,
  };
}

function uniqueItems(items) {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

function initialRoute() {
  if (typeof navigator === 'undefined') return 'home';
  const tvUserAgent = /Android TV|Google TV|Leanback|AFT|SHIELD TV|BRAVIA/i.test(navigator.userAgent);
  return tvUserAgent ? 'tv-home' : 'home';
}

/** Turn a stored history reference back into something the player can open. */
function referenceToContent(reference) {
  if (!reference?.providerItemId && !reference?.detailPath) return null;
  return { provider: 'moviebox', ...reference };
}

function describeError(error) {
  switch (error?.code) {
    case 'API_NOT_CONFIGURED':
      return 'The catalog API is not configured for this build. Unset VITE_MOVIEBOX_API_BASE_URL to use the built-in ZST Labs endpoint, or point it at a valid HTTPS URL, then rebuild.';
    case 'INVALID_API_BASE_URL':
    case 'INSECURE_API_BASE_URL':
      return error.message;
    case 'UNAUTHORIZED':
      return 'The catalog API rejected this build’s API key (HTTP 401/403). Set VITE_ZST_API_KEY to a working key, or remove the override to fall back to the built-in one, then rebuild.';
    case 'RATE_LIMITED':
      return 'The catalog API is rate limited right now. Cached sections still work — try again in a moment.';
    case 'NOT_FOUND':
      return 'The catalog API could not find that title.';
    case 'TIMEOUT':
      return 'The catalog API did not answer in time. Check your connection and try again.';
    case 'NETWORK_ERROR':
      return 'Could not reach the catalog API. Check this device’s connection and try again.';
    default:
      return error?.message || 'Something went wrong while loading the catalog.';
  }
}

function minutesLeft(position, duration) {
  const remainingSeconds = Math.max(0, (Number(duration) || 0) - (Number(position) || 0));
  return Math.max(1, Math.round(remainingSeconds / 60));
}

function captionForLanguage(captions, language) {
  if (!captions?.length) return undefined;
  const code = LANGUAGE_CODES[language];
  return captions.find((entry) => entry.lang === code)
    || captions.find((entry) => entry.language?.toLowerCase() === String(language || '').toLowerCase());
}

/** Start on a quality that is likely to open quickly; fall back downwards from there. */
function pickStartQuality(qualities) {
  if (!qualities?.length) return null;
  return qualities.find((entry) => (entry.resolution || 0) <= 720) || qualities[0];
}

function RoundButton({ children, onClick, label, className = '', type = 'button', ...props }) {
  return <button type={type} className={`round-button ${className}`} onClick={onClick} aria-label={label} {...props}>{children}</button>;
}

function ActionButton({ children, onClick, variant = 'primary', icon: Icon, className = '', ...props }) {
  return <button className={`button button-${variant} ${className}`} onClick={onClick} {...props}>{Icon && <Icon size={17} strokeWidth={2} />}{children}</button>;
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return <div className="toast" role="status"><span className="toast-check"><Check size={15} /></span><span>{message}</span><button onClick={onClose} aria-label="Dismiss"><X size={14} /></button></div>;
}

function SectionLabel({ children, trailing }) {
  return <div className="section-label"><span>{children}</span>{trailing}</div>;
}

/** Short, dismissible provider notice. Browsing is never blocked by it. */
function MaintenanceBanner({ message, onDismiss }) {
  if (!message) return null;
  return (
    <div className="maintenance-banner" role="status">
      <span className="maintenance-dot" />
      <p>{message}</p>
      {onDismiss && <button onClick={onDismiss} aria-label="Dismiss notice"><X size={13} /></button>}
    </div>
  );
}

function HomeScreen({
  onGo,
  onSearch,
  onNotifications,
  onProfile,
  onOpen,
  onPlay,
  isSaved,
  onToggleSaved,
  featured,
  sections = [],
  progressItems = [],
  progressFor,
  loading = false,
  error = '',
  notice = '',
  onDismissNotice,
  onRetry,
}) {
  const hero = featured || sections.flatMap((section) => section.items || [])[0] || null;
  return (
    <main className="home-page">
      <div className="home-hero-art">{hero?.backdrop && <img src={hero.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}</div>
      <div className="home-hero-gradient" />
      <TopBar isHome active="home" onGo={onGo} onSearch={onSearch} onNotifications={onNotifications} onProfile={onProfile} />
      <MaintenanceBanner message={notice} onDismiss={onDismissNotice} />
      <section className="home-hero">
        <div className="hero-content">
          <div className="hero-kicker"><span className="original-mark"><VeyraMark size={15} /></span> {hero ? 'FROM YOUR CATALOG' : 'YOUR PRIVATE CINEMA'}</div>
          <h1>{hero ? hero.title : <>Your next<br /><em>story.</em></>}</h1>
          <p className="hero-description">{hero?.synopsis || (loading ? 'Finding the stories in your catalog.' : error || 'The catalog API is not reachable right now.')}</p>
          {hero && <div className="hero-meta">
            {hero.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {hero.rating}</span>}
            {hero.year && <span>{hero.year}</span>}
            {hero.runtime && <span>{hero.runtime}</span>}
            {hero.genres?.length > 0 && <span>{hero.genres.slice(0, 2).join(' · ')}</span>}
          </div>}
          <div className="hero-actions">
            {hero ? <>
              <button className="button button-primary hero-watch" onClick={() => onPlay(hero)}><Play size={16} fill="currentColor" /> Watch</button>
              <button className={`button button-glass hero-list ${isSaved(hero.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(hero)}>{isSaved(hero.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved(hero.id) ? 'In My List' : 'My List'}</button>
              <button className="hero-more" onClick={() => onOpen(hero)}>Explore title <ArrowRight size={15} /></button>
            </> : <>
              <button className="button button-primary hero-watch" onClick={onSearch}><Search size={16} /> Search catalog</button>
              {error && <button className="button button-glass" onClick={onRetry}><RefreshCw size={15} /> Try again</button>}
            </>}
          </div>
        </div>
        <div className="hero-bottom-note"><span className="hero-index">VEYRA</span><span className="hero-rule" /><span>{hero ? 'CATALOG PREVIEW' : 'WATCH WHAT MOVES YOU'}</span></div>
        <div className="hero-pagination" aria-hidden="true"><span className="page-dot is-active" /></div>
      </section>
      <div className="home-content">
        <div className="home-welcome"><div><span className="eyebrow">A LITTLE MORE YOU</span><h2>Made for your kind of night.</h2></div><button onClick={() => onGo('discover')}>Explore all <ArrowRight size={15} /></button></div>
        {progressItems.length > 0 && <ContentRail title="Continue watching" eyebrow="PICK UP WHERE YOU LEFT OFF" items={progressItems} onItemClick={onPlay} progressFor={progressFor} actionLabel="See all" onAction={() => onGo('continue')} />}
        {loading && <SkeletonRows count={5} />}
        {!loading && error && <ErrorState title={sections.length ? 'Some catalog sections are unavailable.' : 'Your catalog is unavailable.'} description={error} onRetry={onRetry} />}
        {!loading && sections.map((section) => <ContentRail key={section.id} title={section.title} items={section.items} onItemClick={onOpen} actionLabel="" />)}
        {!loading && !error && sections.length === 0 && <EmptyState icon={Compass} title="No catalog titles yet." description="The API responded, but returned no titles with the identifiers VEYRA needs. VEYRA doesn’t fill empty states with sample movies." actionLabel="Search" onAction={onSearch} />}
        <div className="home-footer"><Brand compact onClick={() => onGo('home')} /><span>Stories worth staying for.</span><button onClick={() => onGo('settings')}>Preferences</button></div>
      </div>
    </main>
  );
}

function DiscoverScreen({ onGo, onOpen, selectedType, setSelectedType, sections = [], items = [], loading, error, onRetry }) {
  const [genre, setGenre] = useState('All');
  const visible = items.filter((item) => {
    const matchesType = selectedType === 'all' || item.type === selectedType;
    const matchesGenre = genre === 'All' || item.genres?.some((value) => value.toLowerCase() === genre.toLowerCase());
    return matchesType && matchesGenre;
  });
  return (
    <main className="page-screen discover-screen">
      <TopBar active="discover" onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container discover-content">
        <div className="discover-intro"><span className="eyebrow">A WORLD OF GOOD STORIES</span><h1>Find your next<br /><em>obsession.</em></h1><p>Less scrolling. More feeling.</p><div className="discover-orbit orbit-one" /><div className="discover-orbit orbit-two" /><span className="discover-stamp">CURATED<br />FOR YOU <Sparkles size={14} /></span></div>
        <div className="discover-controls">
          <div className="segmented" role="tablist" aria-label="Content type">{[['all', 'Everything'], ['movie', 'Movies'], ['series', 'Series']].map(([id, label]) => <button key={id} className={selectedType === id ? 'selected' : ''} onClick={() => setSelectedType(id)} role="tab" aria-selected={selectedType === id}>{label}</button>)}</div>
          <div className="genre-scroll">{genres.map((item) => <button key={item} className={`genre-chip ${genre === item ? 'genre-active' : ''}`} onClick={() => setGenre(item)}>{item}</button>)}</div>
        </div>
        {loading ? <SkeletonRows count={6} /> : error && items.length === 0 ? <ErrorState title="Discover is unavailable." description={error} onRetry={onRetry} /> : (
          <>
            {error && items.length > 0 && <ErrorState title="Some catalog sections are unavailable." description={error} onRetry={onRetry} />}
            {sections.slice(0, 3).map((section) => {
              const sectionItems = section.items.filter((item) => (selectedType === 'all' || item.type === selectedType) && (genre === 'All' || item.genres?.some((value) => value.toLowerCase() === genre.toLowerCase())));
              return sectionItems.length ? <ContentRail key={section.id} title={section.title} items={sectionItems} onItemClick={onOpen} actionLabel="" /> : null;
            })}
            <section className="discover-filtered">
              <div className="rail-heading"><div><span className="eyebrow">{genre === 'All' ? 'ALL YOUR NEXTS' : `A LITTLE ${genre.toUpperCase()}`}</span><h2>{genre === 'All' ? (selectedType === 'movie' ? 'Movies' : selectedType === 'series' ? 'Series' : 'Every story, in one place') : `${genre} picks`}</h2></div><span className="result-count">{visible.length} titles</span></div>
              {visible.length ? <div className="poster-grid discover-grid">{visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} />)}</div> : <EmptyState icon={Compass} title="No matching titles." description={error || `There are no ${genre === 'All' ? 'catalog' : genre.toLowerCase()} titles in the loaded sections.`} actionLabel={error ? 'Try again' : undefined} onAction={onRetry} />}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function SearchScreen({ onGo, onOpen }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('ALL');
  const [page, setPage] = useState(1);
  const [retryVersion, setRetryVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState([]);
  const [pager, setPager] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [popular, setPopular] = useState([]);
  const searchRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    if (!term) {
      setLoading(false);
      setError('');
      setFound([]);
      setPager(null);
      setSuggestions([]);
      return () => controller.abort();
    }
    setLoading(true);
    if (page === 1) setError('');
    const timer = window.setTimeout(async () => {
      const [searchResult, suggestionResult] = await Promise.allSettled([
        movieBoxClient.search({ query: term, subjectType: scope, page, perPage: 24, signal: controller.signal }),
        page === 1 ? movieBoxClient.getSearchSuggestions({ query: term, signal: controller.signal }) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      if (searchResult.status === 'fulfilled') {
        const { items: pageItems, pager: pageInfo } = extractSearchPage(searchResult.value);
        setFound((current) => page === 1 ? pageItems : uniqueItems([...current, ...pageItems]));
        setPager({ ...pageInfo, requestedPage: page, returned: pageItems.length });
        if (page === 1) setError('');
      } else {
        if (page === 1) setFound([]);
        setPager(null);
        setError(searchResult.reason?.code === 'ABORTED' ? '' : describeError(searchResult.reason));
      }
      if (page === 1) setSuggestions(suggestionResult.status === 'fulfilled' ? extractSuggestions(suggestionResult.value) : []);
      setLoading(false);
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, scope, page, retryVersion]);

  useEffect(() => {
    if (query.trim()) return undefined;
    const controller = new AbortController();
    movieBoxClient.getPopularSearches({ signal: controller.signal })
      .then((data) => setPopular(extractSuggestions(data).slice(0, 8)))
      .catch(() => setPopular([]));
    return () => controller.abort();
  }, [query]);

  const visible = found.filter((item) => scope === 'ALL' || item.type === (scope === 'MOVIES' ? 'movie' : 'series'));
  const changeQuery = (value) => { setQuery(value); setPage(1); setPager(null); };
  const setScopeFor = (value) => { setScope(value); setPage(1); setPager(null); };
  const retry = () => setRetryVersion((value) => value + 1);
  // Load more is driven by the provider's pager. The length check is only a
  // fallback for responses that carry no pager at all.
  const canLoadMore = Boolean(pager) && (
    pager.hasMore === true
    || (pager.hasMore !== false && pager.returned >= 24)
  );
  const loadMore = () => {
    if (!pager) return;
    const next = Number.isFinite(pager.nextPage) && pager.nextPage > 0 ? pager.nextPage : page + 1;
    setPage(next);
  };
  return (
    <main className="page-screen search-screen">
      <TopBar onGo={onGo} onSearch={() => searchRef.current?.focus()} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container search-content">
        <div className="search-heading"><span className="eyebrow">A GOOD PLACE TO START</span><h1>What are you<br /><em>in the mood for?</em></h1></div>
        <div className="search-field-wrap"><Search size={20} /><input ref={searchRef} value={query} onChange={(event) => changeQuery(event.target.value)} placeholder="Search movies, series, people..." aria-label="Search movies and series" />{query && <button onClick={() => changeQuery('')} aria-label="Clear search"><X size={17} /></button>}<kbd>⌘ K</kbd></div>
        <div className="search-scopes" role="tablist" aria-label="Search in">{[['ALL', 'Everything'], ['MOVIES', 'Movies'], ['TV_SERIES', 'Series']].map(([id, label]) => <button key={id} className={scope === id ? 'scope-active' : ''} onClick={() => setScopeFor(id)} role="tab" aria-selected={scope === id}>{label}</button>)}</div>
        {!query.trim() ? (
          <>
            <SearchEmpty />
            {popular.length > 0 && <div className="trending-searches"><SectionLabel>SEARCHES PEOPLE LOVE</SectionLabel><div>{popular.map((word, index) => <button key={`${word}-${index}`} onClick={() => changeQuery(word)}><span>{String(index + 1).padStart(2, '0')}</span>{word}<ArrowRight size={14} /></button>)}</div></div>}
          </>
        ) : (
          <>
            {suggestions.length > 0 && <div className="suggestion-list"><span className="eyebrow">QUICK MATCHES</span>{suggestions.map((suggestion, index) => {
              const label = typeof suggestion === 'string' ? suggestion : suggestion.title;
              return <button key={`${label}-${index}`} onClick={() => changeQuery(label)}><Search size={15} /><span>{label}</span><ArrowRight size={14} /></button>;
            })}</div>}
            {loading && page === 1 ? <SkeletonRows count={4} /> : null}
            {error && visible.length === 0 ? <ErrorState title="Search is unavailable." description={error} onRetry={retry} /> : visible.length ? (
              <>
                {scope === 'ALL' ? <>
                  {visible.some((item) => item.type === 'movie') && <SearchResultsGroup title="Movies" items={visible.filter((item) => item.type === 'movie')} onOpen={onOpen} />}
                  {visible.some((item) => item.type === 'series') && <SearchResultsGroup title="Series" items={visible.filter((item) => item.type === 'series')} onOpen={onOpen} />}
                  {!visible.some((item) => item.type) && <SearchResultsGroup title="Results" items={visible} onOpen={onOpen} />}
                </> : <SearchResultsGroup title={scope === 'MOVIES' ? 'Movies' : 'Series'} items={visible} onOpen={onOpen} />}
                {error && <ErrorState title="More results couldn’t load." description={error} onRetry={retry} />}
                {loading && page > 1 && <SkeletonRows count={2} />}
                {canLoadMore && !loading && <button className="button button-outline search-load-more" onClick={loadMore}>Load more results <ArrowRight size={15} /></button>}
                {!canLoadMore && !loading && pager?.hasMore === false && <p className="search-end-note">That’s every match the catalog returned for “{query.trim()}”.</p>}
              </>
            ) : !loading && !error ? <EmptyState icon={Search} eyebrow="NO MATCHES JUST YET" title="Nothing came up." description={`The catalog returned no matches for “${query.trim()}”. Try another title or spelling.`} actionLabel="Clear search" onAction={() => changeQuery('')} /> : null}
          </>
        )}
      </div>
    </main>
  );
}

function SearchResultsGroup({ title, items, onOpen }) {
  return <section className="search-results-group"><div className="rail-heading"><div><span className="eyebrow">{title === 'Movies' ? 'FEATURE FILMS' : title === 'Series' ? 'SERIES' : 'CATALOG'}</span><h2>{title}</h2></div><span className="result-count">{items.length} results</span></div><div className="search-result-list">{items.map((item) => <button className="search-result-row" key={item.id} onClick={() => onOpen(item)}><span className="search-result-art">{item.poster ? <img src={item.poster} alt="" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}</span><span className="search-result-copy"><strong>{item.title}</strong><span>{[item.year, item.type === 'series' ? 'Series' : item.type === 'movie' ? 'Film' : '', item.genres?.join(' / ')].filter(Boolean).join(' · ')}</span>{item.synopsis && <small>{item.synopsis}</small>}</span>{item.rating && <span className="result-rating"><Star size={12} fill="currentColor" /> {item.rating}</span>}<ArrowRight className="result-arrow" size={17} /></button>)}</div></section>;
}

function EpisodeRow({ episode, onPlay, isTV = false, progressPercent = 0 }) {
  const episodeLabel = episode.episodeNo || episode.number ? `Episode ${episode.episodeNo || episode.number}` : 'Episode';
  const playLabel = `Play ${episodeLabel}`;
  return (
    <article className={`episode-row ${progressPercent > 0 && progressPercent < 95 ? 'episode-current' : ''}`}>
      <button className="episode-thumb" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`${playLabel}: ${episode.title}`}>
        {episode.thumbnail ? <img src={episode.thumbnail} alt="" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}
        <span><Play size={18} fill="currentColor" /></span>
        {progressPercent > 0 && <ProgressBar value={progressPercent} />}
      </button>
      <div className="episode-copy"><div className="episode-meta"><span>{episodeLabel}</span>{episode.runtime && <><i />{episode.runtime}</>}</div><h3>{episode.title}</h3>{episode.description && <p>{episode.description}</p>}</div>
      <button className="episode-play" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`${playLabel}: ${episode.title}`}><Play size={18} fill="currentColor" /></button>
    </article>
  );
}

function DetailScreen({ item, onBack, onPlay, onToggleSaved, isSaved, onDownload, onOpen, isTV, progressFor }) {
  const [details, setDetails] = useState({ content: item, seasons: [], recommendations: [], recommendationsError: '', loading: true, error: '' });
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!item?.providerItemId && !item?.detailPath) {
      setDetails({ content: item, seasons: [], recommendations: [], recommendationsError: '', loading: false, error: 'This catalog item has no subjectId, so its detail endpoint cannot be requested.' });
      return () => controller.abort();
    }
    setDetails((current) => ({ ...current, content: item, loading: true, error: '' }));
    const detailPromise = movieBoxClient.getItemDetails({ subjectId: item.providerItemId, detailPath: item.detailPath, signal: controller.signal });
    const recommendationPromise = item.providerItemId
      ? movieBoxClient.getRecommendations({ subjectId: item.providerItemId, signal: controller.signal })
      : Promise.reject(Object.assign(new Error('Recommendations need a subjectId.'), { code: 'NO_SUBJECT_ID' }));
    Promise.allSettled([detailPromise, recommendationPromise]).then(([detailResult, recommendationResult]) => {
      if (controller.signal.aborted) return;
      let content = item;
      let seasonsForItem = [];
      let error = '';
      if (detailResult.status === 'fulfilled') {
        const normalized = normalizeDetail(detailResult.value, item);
        content = normalized.content || item;
        seasonsForItem = normalized.seasons;
      } else error = describeError(detailResult.reason);
      const recommendations = recommendationResult.status === 'fulfilled' ? extractContentList(recommendationResult.value).filter((entry) => entry.id !== item.id) : [];
      const recommendationsError = recommendationResult.status === 'rejected' && recommendationResult.reason?.code !== 'NO_SUBJECT_ID'
        ? describeError(recommendationResult.reason)
        : '';
      setDetails({ content, seasons: seasonsForItem, recommendations, recommendationsError, loading: false, error });
      setSelectedSeasonId((current) => current && seasonsForItem.some((season) => season.id === current) ? current : seasonsForItem[0]?.id || '');
    });
    return () => controller.abort();
  }, [item, retryKey]);

  const content = details.content || item;
  const season = details.seasons.find((entry) => entry.id === selectedSeasonId) || details.seasons[0];
  const episodeList = season?.episodes || [];
  const isSeries = content.type === 'series' || details.seasons.length > 0;
  const playable = content.hasResource !== false;
  return (
    <main className={`detail-screen ${isTV ? 'tv-detail-screen' : ''}`}>
      <section className="detail-hero">
        {content.backdrop && <img className="detail-art" src={content.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}
        <div className="detail-art-wash" />
        <div className="detail-topline"><BackButton onClick={onBack} /><div className="detail-top-actions"><RoundButton label="Copy title" onClick={() => navigator.clipboard?.writeText(content.title).catch(() => {})}><ArrowRight size={17} /></RoundButton><RoundButton label="More title information" onClick={() => document.getElementById('about-title')?.scrollIntoView({ behavior: 'smooth' })}><MoreHorizontal size={18} /></RoundButton></div></div>
        <div className="detail-hero-layout">
          <div className="detail-copy">
            <span className="detail-badge"><VeyraMark size={14} /> {isSeries ? 'SERIES' : content.type === 'movie' ? 'FILM' : 'CATALOG TITLE'}</span>
            <h1>{content.title}</h1>
            <div className="detail-meta">{content.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {content.rating}</span>}{content.year && <span>{content.year}</span>}{content.runtime && <span>{content.runtime}</span>}{content.maturity && <span className="meta-maturity">{content.maturity}</span>}</div>
            {content.genres?.length > 0 && <div className="detail-genres">{content.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>}
            <p className="detail-description">{content.synopsis || (details.loading ? 'Loading catalog details…' : 'No synopsis was provided by the catalog.')}</p>
            <div className="detail-actions">
              <ActionButton
                data-tv-focus={isTV ? 'true' : undefined}
                onClick={() => onPlay(content, isSeries ? episodeList[0] : null)}
                icon={Play}
                disabled={!playable}
              >
                {isSeries ? 'Play first episode' : 'Play'}
              </ActionButton>
              <button data-tv-focus={isTV ? 'true' : undefined} className={`button button-glass ${isSaved(content.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(content)}>{isSaved(content.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved(content.id) ? 'In My List' : 'My List'}</button>
              <button className="round-button detail-download" data-tv-focus={isTV ? 'true' : undefined} aria-label="Download this title" title="Ask the provider for a download link" onClick={() => onDownload(content, isSeries && season ? { season: season.apiValue ?? 0, episode: episodeList[0]?.episodeNo || 1, label: `${season.label} · Episode ${episodeList[0]?.episodeNo || 1}` } : {})}><Download size={17} /></button>
            </div>
            {!playable && <p className="detail-source-note"><CloudOff size={14} /> The provider lists this title with no playable media source right now.</p>}
            {isSeries && season?.label && <div className="detail-continue-note"><span className="live-dot" /> {season.label} <span>·</span> {episodeList.length} episodes</div>}
          </div>
          {content.poster && <div className="detail-poster"><img src={content.poster} alt={`${content.title} poster`} onError={(event) => event.currentTarget.remove()} /><span><VeyraMark size={13} /> VEYRA</span></div>}
        </div>
        <div className="detail-edge-label">A STORY TO STAY WITH YOU</div>
      </section>
      <div className="detail-body page-container">
        {details.error && <ErrorState title="Some details could not be loaded." description={details.error} onRetry={() => setRetryKey((value) => value + 1)} />}
        <section id="about-title" className="about-block"><span className="eyebrow">THE STORY</span><h2>About <em>{content.title}</em></h2><p>{content.synopsis || 'No description was provided by the catalog.'}</p><div className="credits">{content.director && <span><small>DIRECTED BY</small>{content.director}</span>}{content.genres?.length > 0 && <span><small>GENRE</small>{content.genres.join(' · ')}</span>}{content.maturity && <span><small>RATING</small>{content.maturity}</span>}</div></section>
        {isSeries && (
          <section className="episodes-section">
            <div className="rail-heading episode-heading"><div><span className="eyebrow">SEASONS & EPISODES</span><h2>Episodes</h2></div>{details.seasons.length > 0 && <label className="season-select"><span className="sr-only">Select season</span><select data-tv-focus={isTV ? 'true' : undefined} value={season?.id || ''} onChange={(event) => setSelectedSeasonId(event.target.value)}>{details.seasons.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select><ChevronDown size={16} /></label>}</div>
            {details.loading ? <SkeletonRows count={3} /> : episodeList.length ? <div className="episode-list">{episodeList.map((episode) => {
              const entry = progressFor?.(content.id, season?.apiValue, episode.episodeNo || episode.number);
              return <EpisodeRow key={episode.id} episode={episode} isTV={isTV} progressPercent={entry?.percent || 0} onPlay={() => onPlay(content, episode, season?.apiValue)} />;
            })}</div> : <EmptyState icon={Film} title="No episodes were listed." description="The provider returned this series without an episode list, so VEYRA has nothing real to play. It does not invent seasons or episodes." quiet />}
          </section>
        )}
        {(content.cast?.length > 0 || content.director) && <section className="cast-section"><div className="rail-heading"><div><span className="eyebrow">THE PEOPLE IN IT</span><h2>Cast & creators</h2></div>{content.director && <span className="cast-note">Directed by {content.director}</span>}</div>{content.cast?.length > 0 && <div className="cast-list">{content.cast.map((person, index) => <div className="cast-person" key={`${person}-${index}`}><span className={`cast-avatar cast-avatar-${index % 4}`}><span>{person.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span></span><span>{person}</span></div>)}</div>}</section>}
        {details.recommendationsError && <ErrorState title="Recommendations are unavailable." description={details.recommendationsError} onRetry={() => setRetryKey((value) => value + 1)} />}
        {details.recommendations.length > 0 && <ContentRail title="More like this" eyebrow="KEEP THE FEELING GOING" items={details.recommendations} onItemClick={onOpen} actionLabel="" />}
      </div>
    </main>
  );
}

/**
 * Real playback.
 *
 * Everything shown here comes from the <video> element and from /api/media:
 * no timers fake progress, no external player is opened. Stream URLs are
 * signed, so media is fetched fresh on every play and quality change.
 */
function PlayerScreen({
  content: initialContent,
  episode: initialEpisode = null,
  season: initialSeason = null,
  startPosition = 0,
  onBack,
  onProgress,
  preferredLanguage = 'English',
  isTV = false,
}) {
  const videoRef = useRef(null);
  const [detail, setDetail] = useState({ content: initialContent, seasons: [] });
  const [detailError, setDetailError] = useState('');
  const [media, setMedia] = useState(null);
  const [phase, setPhase] = useState('loading');
  const [message, setMessage] = useState('');
  const [sourceNote, setSourceNote] = useState('');
  const [activeQuality, setActiveQuality] = useState(null);
  const [sheet, setSheet] = useState('');
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [controlsPing, setControlsPing] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // The status label is derived from the element, never from the API phase
  // alone: a media response is not playback.
  const [videoReady, setVideoReady] = useState(0);
  const [needsGesture, setNeedsGesture] = useState(false);
  const [captionChoice, setCaptionChoice] = useState('off');
  const [captionTrack, setCaptionTrack] = useState(null);
  const [captionNote, setCaptionNote] = useState('');
  const [seasonNumber, setSeasonNumber] = useState(initialSeason);
  const [episodeNumber, setEpisodeNumber] = useState(initialEpisode?.episodeNo || initialEpisode?.number || null);
  const [reloadToken, setReloadToken] = useState(0);
  const [showNext, setShowNext] = useState(false);

  const content = detail.content || initialContent;
  const seasons = detail.seasons;
  const isSeries = content?.type === 'series' || seasons.length > 0;
  const seasonIndex = seasons.findIndex((entry) => String(entry.apiValue) === String(seasonNumber));
  const season = seasons[seasonIndex >= 0 ? seasonIndex : 0];
  const episodeList = season?.episodes || [];
  const episodeLabel = isSeries && season?.apiValue !== undefined && episodeNumber
    ? `Season ${season.apiValue} · Episode ${episodeNumber}`
    : '';

  const seekTargetRef = useRef(startPosition);
  const activeQualityRef = useRef(null);
  const failedSourcesRef = useRef(new Set());
  // True while autoplay is merely waiting for a tap, so the stall watchdog
  // does not blame the source for a browser gesture requirement.
  const gestureBlockedRef = useRef(false);
  const [detailSettled, setDetailSettled] = useState(false);
  const latestRef = useRef({});
  const lastSavedRef = useRef({ at: 0, position: 0 });

  latestRef.current = { content, media, season, episodeNumber, episodeLabel, currentTime, duration, isSeries, episodeList };

  /* ---------------- detail (seasons for series) ---------------- */
  useEffect(() => {
    const controller = new AbortController();
    if (!initialContent?.providerItemId && !initialContent?.detailPath) return () => controller.abort();
    const wantsSeasons = initialContent?.type === 'series' || initialSeason !== null || initialEpisode !== null;
    if (!wantsSeasons) {
      setDetail({ content: initialContent, seasons: [] });
      setDetailSettled(true);
      return () => controller.abort();
    }
    movieBoxClient.getItemDetails({ subjectId: initialContent.providerItemId, detailPath: initialContent.detailPath, signal: controller.signal })
      .then((payload) => {
        if (controller.signal.aborted) return;
        const normalized = normalizeDetail(payload, initialContent);
        setDetail({ content: normalized.content || initialContent, seasons: normalized.seasons });
        setDetailSettled(true);
      })
      .catch((error) => {
        if (controller.signal.aborted || error?.code === 'ABORTED') return;
        setDetailError(describeError(error));
        setDetail({ content: initialContent, seasons: [] });
        setDetailSettled(true);
      });
    return () => controller.abort();
  }, [initialContent, initialEpisode, initialSeason]);

  // Choose a real episode to play when a series was opened without one.
  useEffect(() => {
    if (!isSeries || episodeNumber || !seasons.length) return;
    const first = seasons.find((entry) => entry.episodes?.length);
    if (!first) return;
    setSeasonNumber(first.apiValue);
    setEpisodeNumber(first.episodes[0].episodeNo || first.episodes[0].number);
  }, [isSeries, seasons, episodeNumber]);

  /* ---------------- media ---------------- */
  const loadMedia = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    if (!content?.providerItemId && !content?.detailPath) {
      setPhase('error');
      setMessage('This item has no catalog identifier, so no media can be requested.');
      return () => controller.abort();
    }
    if (isSeries && !episodeNumber) {
      if (detailSettled) {
        setPhase('unavailable');
        setMessage(detailError || 'The provider listed this series without any episodes, so there is nothing real to play here. Browsing and details still work.');
      }
      return () => controller.abort();
    }
    if (!isMovieBoxConfigured()) {
      setPhase('error');
      setMessage('The catalog API is not configured for this build.');
      return () => controller.abort();
    }
    setPhase('loading');
    setMessage('');
    setSourceNote('');
    let cancelled = false;
    (async () => {
      try {
        const payload = await movieBoxClient.getMedia({
          subjectId: content.providerItemId,
          detailPath: content.detailPath,
          season: isSeries ? Number(seasonNumber) || 0 : 0,
          episode: isSeries ? Number(episodeNumber) || 0 : 0,
          signal: controller.signal,
          fresh: true,
        });
        if (cancelled) return;
        const normalized = normalizeMedia(payload);
        setMedia(normalized);
        if (!normalized.qualities.length || !normalized.hasResource) {
          setPhase('unavailable');
          setMessage('The provider has no playable source for this selection right now. That is usually maintenance on the streaming side — browsing and details still work.');
          return;
        }
        failedSourcesRef.current = new Set();
        const preferred = captionForLanguage(normalized.captions, preferredLanguage);
        setCaptionChoice(preferred ? preferred.lang : 'off');
        setCaptionNote('');
        setShowNext(false);
        setActiveQuality((current) => {
          // Take the object from the fresh response even when the URL matches:
          // a reload must use the newly signed link, not a stale reference.
          const match = current && normalized.qualities.find((entry) => entry.streamUrl === current.streamUrl);
          return match || pickStartQuality(normalized.qualities);
        });
        setPhase('ready');
      } catch (error) {
        if (cancelled || error?.code === 'ABORTED') return;
        setPhase('error');
        setMessage(describeError(error));
      }
    })();
    return () => { cancelled = true; controller.abort(); };
  }, [content?.providerItemId, content?.detailPath, seasonNumber, episodeNumber, reloadToken, isSeries, seasons.length, detailError, detailSettled]);

  /* ---------------- source loading, watchdog, autoplay ---------------- */
  const failSource = useCallback(async (reason) => {
    const list = latestRef.current.media?.qualities || [];
    const currentUrl = activeQualityRef.current?.streamUrl;
    if (currentUrl) failedSourcesRef.current.add(currentUrl);
    const index = list.findIndex((entry) => entry.streamUrl === currentUrl);
    const next = index >= 0 ? list.slice(index + 1).find((entry) => !failedSourcesRef.current.has(entry.streamUrl)) : undefined;
    if (next) {
      setSourceNote(reason === 'timeout'
        ? 'That stream timed out. Trying the next lower quality…'
        : 'That stream did not start. Trying the next lower quality…');
      setActiveQuality(next);
      return;
    }
    if (list.length && index >= 0) {
      // One more honest attempt: tell the user how the provider responded.
      const probe = await probeMediaUrl(currentUrl || '', { timeoutMs: 6000 });
      const detail = probe.status === 426 ? 'the provider asked for an upgrade (HTTP 426)'
        : probe.status === 429 ? 'the provider rate limited the stream (HTTP 429)'
          : probe.reason === 'TIMEOUT' ? 'it did not answer within 20 seconds'
            : 'it did not return video';
      setSourceNote(`Every returned quality failed — ${detail}.`);
    }
    setPhase('error');
    setMessage('Source busy. Try again.');
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    // No stream URL means no media to attach: never load() or play() here, or
    // the UI would report playback while the element holds nothing.
    if (!video || !activeQuality?.streamUrl) return undefined;
    activeQualityRef.current = activeQuality;
    setBuffering(true);
    setCurrentTime(seekTargetRef.current || 0);
    // The src is bound on the element itself (see the <video> below), so the
    // browser has already been told what to fetch; play() only starts it.
    const playAttempt = video.play();
    if (playAttempt?.catch) {
      playAttempt.catch((error) => {
        gestureBlockedRef.current = true;
        setNeedsGesture(error?.name === 'NotAllowedError');
        setBuffering(false);
      });
    }
    const timer = window.setTimeout(() => {
      // Only a stall with a real source and a real play attempt counts.
      if (video.readyState < 2 && !gestureBlockedRef.current) failSource('timeout');
    }, PLAYER_STALL_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [activeQuality, failSource]);

  useEffect(() => () => { failedSourcesRef.current = new Set(); }, []);

  /* ---------------- progress persistence ---------------- */
  const reportProgress = useCallback(({ position, seconds, completed = false, force = false }) => {
    if (!onProgress) return;
    const total = Number(seconds) || 0;
    if (!total || total < 30) return;
    const now = Date.now();
    if (!force && !completed && now - lastSavedRef.current.at < 5000) return;
    if (!force && !completed && Math.abs(position - lastSavedRef.current.position) < 10) return;
    lastSavedRef.current = { at: now, position };
    const snapshot = latestRef.current;
    onProgress({
      content: snapshot.content,
      season: snapshot.isSeries ? snapshot.season?.apiValue ?? null : null,
      episode: snapshot.isSeries ? Number(snapshot.episodeNumber) || null : null,
      label: snapshot.episodeLabel,
      position,
      duration: total,
      percent: Math.max(0, Math.min(100, (position / total) * 100)),
      completed,
    });
  }, [onProgress]);

  useEffect(() => () => {
    const video = videoRef.current;
    if (!video) return;
    reportProgress({ position: video.currentTime, seconds: video.duration, force: true });
  }, [reportProgress]);

  /* ---------------- element handlers ---------------- */
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setVideoReady(video.readyState);
    setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const target = seekTargetRef.current;
    if (target > 1) {
      const total = Number.isFinite(video.duration) ? video.duration : 0;
      if (!total || target < total - 2) {
        try { video.currentTime = target; } catch { /* seeking before buffering can throw */ }
      }
    }
    seekTargetRef.current = 0;
  };

  const handleVideoError = () => {
    const video = videoRef.current;
    // An element without a source raises MediaError too; that is not a
    // provider failure and must not step the quality ladder.
    if (!video || !activeQualityRef.current?.streamUrl || !video.error) return;
    if (phase === 'loading') return;
    failSource('error');
  };

  const handleEnded = () => {
    const video = videoRef.current;
    reportProgress({ position: video?.duration || 0, seconds: video?.duration, completed: true, force: true });
    setPlaying(false);
    const list = latestRef.current.episodeList || [];
    const order = Number(latestRef.current.episodeNumber) || 0;
    setShowNext(Boolean(latestRef.current.isSeries && list.some((entry) => (entry.episodeNo || entry.number || 0) > order)));
  };

  const seekBy = (delta) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min((video.duration || 0) - 1, video.currentTime + delta));
    video.currentTime = target;
    setCurrentTime(target);
    setControlsPing((value) => value + 1);
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    setControlsPing((value) => value + 1);
  };

  const changeQuality = (quality) => {
    const video = videoRef.current;
    const position = video?.currentTime || currentTime;
    // The element is remounted for the new URL; this restores the position once
    // the new stream has metadata.
    seekTargetRef.current = position;
    gestureBlockedRef.current = false;
    setNeedsGesture(false);
    setActiveQuality(quality);
    setSheet('');
    setControlsPing((value) => value + 1);
  };

  const changeEpisode = (episode, seasonValue) => {
    seekTargetRef.current = 0;
    failedSourcesRef.current = new Set();
    gestureBlockedRef.current = false;
    setNeedsGesture(false);
    setVideoReady(0);
    if (seasonValue !== undefined && seasonValue !== null) setSeasonNumber(seasonValue);
    setEpisodeNumber(episode.episodeNo || episode.number);
    setSheet('');
    setShowNext(false);
    loadMedia();
  };

  const playNextEpisode = () => {
    const list = latestRef.current.episodeList || [];
    const order = Number(latestRef.current.episodeNumber) || 0;
    const next = list.find((entry) => (entry.episodeNo || entry.number || 0) > order);
    if (next) changeEpisode(next, season?.apiValue);
  };

  /* ---------------- captions ---------------- */
  useEffect(() => {
    if (captionChoice === 'off' || !media) {
      setCaptionTrack(null);
      return undefined;
    }
    const caption = media.captions.find((entry) => entry.lang === captionChoice);
    if (!caption) {
      setCaptionTrack(null);
      return undefined;
    }
    let cancelled = false;
    setCaptionNote('Loading subtitles…');
    loadSubtitleTrack(caption.url)
      .then((url) => {
        if (cancelled) return;
        setCaptionTrack({ url, lang: caption.lang, langName: caption.language });
        setCaptionNote('');
      })
      .catch((error) => {
        if (cancelled) return;
        setCaptionTrack(null);
        setCaptionNote(error?.message || 'This subtitle track could not be loaded.');
      });
    return () => { cancelled = true; };
  }, [captionChoice, media]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const tracks = video.textTracks;
    for (let index = 0; index < tracks.length; index += 1) {
      tracks[index].mode = captionTrack && tracks[index].language === captionTrack.lang ? 'showing' : 'disabled';
    }
  }, [captionTrack, activeQuality]);

  /* ---------------- player keyboard / remote ---------------- */
  useEffect(() => {
    const handleKey = (event) => {
      const tag = event.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        event.stopPropagation();
        if (sheet) setSheet('');
        else onBack();
        return;
      }
      if (event.key === ' ') { event.preventDefault(); togglePlay(); return; }
      if (event.key === 'ArrowRight') { event.preventDefault(); seekBy(10); return; }
      if (event.key === 'ArrowLeft') { event.preventDefault(); seekBy(-10); return; }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        setControlsPing((value) => value + 1);
        setSheet((current) => (current ? '' : 'quality'));
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [onBack, sheet]);

  const controlsVisible = !playing || sheet !== '' || controlsPing > 0;

  useEffect(() => {
    if (!playing || sheet) return undefined;
    const timer = window.setTimeout(() => setControlsPing(0), 4000);
    return () => window.clearTimeout(timer);
  }, [playing, sheet, controlsPing]);

  const progressPercent = duration ? Math.min(100, (currentTime / duration) * 100) : 0;
  // Element duration wins once metadata arrives; the provider value is only an
  // estimate until then, and is labelled as one.
  const durationIsEstimate = !duration && Boolean(media?.duration);
  const totalDuration = duration || media?.duration || 0;
  const hasSource = Boolean(activeQuality?.streamUrl);
  const statusLabel = phase === 'loading' ? 'CONNECTING'
    : phase === 'error' ? 'SOURCE BUSY'
      : phase === 'unavailable' ? 'NO SOURCE'
        : !hasSource ? 'NO SOURCE'
          : playing && !buffering && videoReady >= 2 ? 'PLAYING'
            : buffering || videoReady < 2 ? 'BUFFERING'
              : 'PAUSED';
  const hasCaptions = Boolean(media?.captions?.length);

  return (
    <main className={`player-screen ${isTV ? 'tv-player-screen' : ''} ${controlsVisible ? '' : 'player-idle'}`}>
      <div className="player-stage" style={{ backgroundImage: content?.backdrop ? `url('${content.backdrop}')` : undefined }}>
        <video
          ref={videoRef}
          key={activeQuality?.streamUrl || 'empty'}
          className="player-video"
          src={activeQuality?.streamUrl || undefined}
          playsInline
          preload="auto"
          poster={content?.poster || content?.backdrop}
          onLoadStart={() => setVideoReady(0)}
          onLoadedMetadata={handleLoadedMetadata}
          onLoadedData={() => setVideoReady(videoRef.current?.readyState || 0)}
          onDurationChange={() => {
            const video = videoRef.current;
            if (video) setDuration(Number.isFinite(video.duration) ? video.duration : 0);
          }}
          onTimeUpdate={() => {
            const video = videoRef.current;
            if (!video) return;
            setCurrentTime(video.currentTime);
            reportProgress({ position: video.currentTime, seconds: video.duration || totalDuration });
          }}
          onPlay={() => {
            gestureBlockedRef.current = false;
            setNeedsGesture(false);
            setPlaying(true);
            setBuffering(false);
          }}
          onPause={() => {
            setPlaying(false);
            const video = videoRef.current;
            reportProgress({ position: video?.currentTime || 0, seconds: video?.duration || totalDuration, force: true });
          }}
          onWaiting={() => setBuffering(true)}
          onStalled={() => setBuffering(true)}
          onPlaying={() => {
            setVideoReady(videoRef.current?.readyState || 0);
            setBuffering(false);
            setSourceNote('');
          }}
          onCanPlay={() => { setVideoReady(videoRef.current?.readyState || 0); setBuffering(false); }}
          onCanPlayThrough={() => setVideoReady(videoRef.current?.readyState || 0)}
          onEmptied={() => { setVideoReady(0); setBuffering(true); }}
          onError={handleVideoError}
          onEnded={handleEnded}
          onClick={() => setControlsPing((value) => (value > 0 ? 0 : value + 1))}
          aria-label={`${content?.title || 'Video'} player`}
        >
          {captionTrack && <track kind="subtitles" src={captionTrack.url} srcLang={captionTrack.lang} label={captionTrack.langName} default />}
        </video>
        <div className="player-scrim" />
      </div>

      <div className={`player-ui ${controlsVisible ? 'controls-visible' : 'controls-hidden'}`}>
        <header className="player-top">
          <button className="player-back" onClick={onBack} aria-label="Back"><ChevronLeft size={22} /><span>{content?.title || 'VEYRA'}</span></button>
          <div className="player-top-center">
            <span className="player-status"><span /> {statusLabel}</span>
            {episodeLabel && <span className="player-episode-heading">{episodeLabel}</span>}
          </div>
          <div className="player-top-actions">
            <RoundButton label="Reload stream" onClick={loadMedia}><RefreshCw size={16} /></RoundButton>
          </div>
        </header>

        {phase === 'loading' && (
          <div className="buffering-indicator"><Loader2 size={30} /><span>Requesting a fresh stream link…</span></div>
        )}

        {phase === 'ready' && needsGesture && (
          <div className="buffering-indicator"><Play size={26} fill="currentColor" /><span>Press play to start</span></div>
        )}

        {phase === 'ready' && !needsGesture && buffering && (
          <div className="buffering-indicator"><Loader2 size={26} /><span>{hasSource ? 'Buffering' : 'Waiting for a source'}</span></div>
        )}

        {(phase === 'error' || phase === 'unavailable') && (
          <div className="player-error">
            <span><CloudOff size={23} /></span>
            <h2>{phase === 'unavailable' ? 'No source for this title.' : 'Source busy.'}</h2>
            <p>{message || (phase === 'unavailable' ? 'The provider has no playable media for this selection yet.' : 'Try again — signed stream links are refreshed when you retry.')}</p>
            <div className="player-error-actions">
              <ActionButton icon={RefreshCw} onClick={() => { failedSourcesRef.current = new Set(); loadMedia(); }}>Try again</ActionButton>
              <button className="button button-glass" onClick={onBack}><ChevronLeft size={16} /> Back</button>
            </div>
            {sourceNote && <small className="player-error-note">{sourceNote}</small>}
          </div>
        )}

        {phase === 'ready' && (
          <>
            <div className="player-center-controls">
              <button onClick={() => seekBy(-10)} aria-label="Back 10 seconds"><Rewind size={20} /><small>10</small></button>
              <button className="player-main-control" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}</button>
              <button onClick={() => seekBy(10)} aria-label="Forward 10 seconds"><FastForward size={20} /><small>10</small></button>
            </div>
            {showNext && <div className="next-episode-card"><span className="eyebrow">UP NEXT</span><span className="next-episode-number">{episodeLabel}</span><h3>Play the next episode</h3><button onClick={playNextEpisode}><Play size={12} fill="currentColor" /> Play next</button></div>}
            <footer className="player-footer">
              <div className="player-title-line">
                <div><span className="eyebrow">{isSeries ? 'EPISODE' : 'FILM'}</span><h2>{content?.title}</h2></div>
                {sourceNote && <span className="preview-tag">{sourceNote}</span>}
              </div>
              <input
                className="seek-slider"
                type="range"
                min="0"
                max={Math.max(1, Math.floor(totalDuration))}
                step="1"
                value={Math.floor(currentTime)}
                style={{ '--range-progress': `${progressPercent}%` }}
                onChange={(event) => {
                  const video = videoRef.current;
                  const value = Number(event.target.value);
                  if (video) video.currentTime = value;
                  setCurrentTime(value);
                }}
                aria-label="Seek"
              />
              <div className="time-row">
                <span>{formatDuration(currentTime)}</span>
                <span>{progressPercent ? `${Math.round(progressPercent)}%` : '—'}</span>
                <span>{durationIsEstimate ? `~${formatDuration(totalDuration)}` : formatDuration(totalDuration)}</span>
              </div>
              <div className="player-tools">
                <button onClick={() => setSheet('quality')}><Gauge size={15} /><span>{activeQuality?.label || 'Quality'}</span></button>
                <button onClick={() => setSheet('captions')}><Captions size={15} /><span>{captionTrack ? captionTrack.langName : 'Subtitles'}</span></button>
                {isSeries && <button onClick={() => setSheet('episodes')}><Film size={15} /><span>Episodes</span></button>}
                <button onClick={() => setSheet('about')}><CircleHelp size={15} /><span>Source</span></button>
              </div>
              {captionNote && <small className="player-mock-note">{captionNote}</small>}
            </footer>
          </>
        )}
      </div>

      {sheet && (
        <div className="dialog-backdrop sheet-backdrop" role="presentation" onClick={() => setSheet('')}>
          <section className="bottom-sheet" role="dialog" aria-modal="true" aria-label={sheet} onClick={(event) => event.stopPropagation()}>
            <span className="sheet-grabber" />
            {sheet === 'quality' && <>
              <div className="sheet-heading"><div><span className="eyebrow">STREAM</span><h2>Quality</h2><p>{media?.qualities?.length || 0} progressive MP4 sources returned by the provider</p></div><button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button></div>
              <div className="option-list">
                {(media?.qualities || []).map((quality) => (
                  <button key={quality.streamUrl} className={quality.streamUrl === activeQuality?.streamUrl ? 'option-selected' : ''} onClick={() => changeQuality(quality)}>
                    <span className="option-check">{quality.streamUrl === activeQuality?.streamUrl ? <Check size={12} /> : null}</span>
                    {quality.label}
                    <small>{quality.sizeBytes ? `${(quality.sizeBytes / 1024 / 1024 / 1024).toFixed(2)} GB` : 'MP4'}</small>
                  </button>
                ))}
              </div>
            </>}
            {sheet === 'captions' && <>
              <div className="sheet-heading"><div><span className="eyebrow">SUBTITLES</span><h2>Caption track</h2><p>{hasCaptions ? 'Only the languages this title actually returns' : 'The provider returned no captions for this title'}</p></div><button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button></div>
              <div className="option-list">
                <button className={captionChoice === 'off' ? 'option-selected' : ''} onClick={() => { setCaptionChoice('off'); setSheet(''); }}><span className="option-check">{captionChoice === 'off' ? <Check size={12} /> : null}</span>Off</button>
                {(media?.captions || []).map((caption) => (
                  <button key={caption.lang} className={captionChoice === caption.lang ? 'option-selected' : ''} onClick={() => { setCaptionChoice(caption.lang); setSheet(''); }}>
                    <span className="option-check">{captionChoice === caption.lang ? <Check size={12} /> : null}</span>
                    {caption.language}
                  </button>
                ))}
              </div>
              {captionNote && <p className="sheet-note">{captionNote}</p>}
              <p className="sheet-note">Subtitles are converted from the provider’s SubRip files in the app and shown straight from the video element.</p>
            </>}
            {sheet === 'episodes' && <>
              <div className="sheet-heading"><div><span className="eyebrow">{season?.label || 'SERIES'}</span><h2>Episodes</h2><p>{episodeList.length} episodes listed by the provider</p></div><button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button></div>
              {seasons.length > 1 && <label className="season-select sheet-season"><span className="sr-only">Select season</span><select value={season?.id || ''} onChange={(event) => {
                const target = seasons.find((entry) => entry.id === event.target.value);
                if (target?.episodes?.length) changeEpisode(target.episodes[0], target.apiValue);
              }}>{seasons.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select><ChevronDown size={16} /></label>}
              <div className="sheet-episode-list">
                {episodeList.map((episode) => {
                  const selected = String(episode.episodeNo || episode.number) === String(episodeNumber);
                  return <button key={episode.id} className={selected ? 'sheet-episode-active' : ''} onClick={() => changeEpisode(episode, season?.apiValue)}><span>E{episode.episodeNo || episode.number}</span><strong>{episode.title}</strong><small>{episode.runtime || ''}</small>{selected ? <Check size={14} /> : <Play size={13} />}</button>;
                })}
              </div>
            </>}
            {sheet === 'about' && <>
              <div className="sheet-heading"><div><span className="eyebrow">SOURCE</span><h2>Where this plays from</h2></div><button className="sheet-close" onClick={() => setSheet('')} aria-label="Close"><X size={16} /></button></div>
              <div className="option-list">
                <button className="option-static"><span className="option-check"><Check size={12} /></span>Provider proxy stream (MP4)</button>
                <button className="option-static"><span className="option-check" />Catalog: {getMovieBoxApiBaseUrl() || 'not configured'}</button>
                <button className="option-static"><span className="option-check" />Streaming is progressive MP4 only — the provider returns no HLS/DASH</button>
              </div>
              <p className="sheet-note">Stream links are signed and expire, so VEYRA requests a fresh /api/media link on every play and quality change.</p>
            </>}
          </section>
        </div>
      )}
    </main>
  );
}

function BackButton({ onClick, label = 'Back' }) {
  return <button className="back-button" onClick={onClick} aria-label={label}><ChevronLeft size={19} /><span>{label}</span></button>;
}

function MyListScreen({ onGo, onOpen, savedItems, onRemove }) {
  const [tab, setTab] = useState('all');
  const visible = savedItems.filter((item) => tab === 'all' || item.type === tab);
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container library-page"><PageTitle eyebrow="YOUR PRIVATE SHELF" title="My List" description="Saved references stay on this device." right={<span className="library-count">{visible.length} saved</span>} />
        <div className="library-tabs" role="tablist"><button className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')}>Everything <span>{savedItems.length}</span></button><button className={tab === 'movie' ? 'selected' : ''} onClick={() => setTab('movie')}>Movies <span>{savedItems.filter((item) => item.type === 'movie').length}</span></button><button className={tab === 'series' ? 'selected' : ''} onClick={() => setTab('series')}>Series <span>{savedItems.filter((item) => item.type === 'series').length}</span></button></div>
        {visible.length ? <div className="poster-grid library-grid">{visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} onRemove={onRemove} />)}</div> : <EmptyState icon={Heart} title="Nothing here yet." description="Save a title to keep its provider reference on this device." actionLabel="Explore catalog" onAction={() => onGo('discover')} />}
      </div>
    </main>
  );
}

function ContinueScreen({ onGo, onOpen, items = [], onPlay }) {
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container continue-page"><PageTitle eyebrow="PICK UP WHERE YOU LEFT OFF" title="Keep watching." description="Only real playback writes progress here." />
      {items.length ? <div className="continue-list">{items.map((entry) => <article className="continue-card" key={entry.id}><button className="continue-art" onClick={() => onPlay(entry)}>{entry.content.poster && <img src={entry.content.poster} alt="" onError={(event) => event.currentTarget.remove()} />}<span><Play size={18} fill="currentColor" /></span><ProgressBar value={entry.percent} /></button><div className="continue-info"><span className="eyebrow">{entry.label || (entry.content.type === 'series' ? 'SERIES' : 'FEATURE FILM')}</span><h2>{entry.content.title}</h2><p>{entry.remainingLabel} <span>·</span> {Math.round(entry.percent)}% watched</p><div className="continue-actions"><ActionButton onClick={() => onPlay(entry)} icon={Play}>Resume</ActionButton><button className="text-button" onClick={() => onOpen(entry.content)}>View details <ArrowRight size={15} /></button></div></div></article>)}</div> : <EmptyState icon={Clock3} title="Nothing to resume." description="Continue Watching shows titles you actually played, between 2% and 95%." actionLabel="Browse catalog" onAction={() => onGo('discover')} />}
    </div></main>
  );
}

function HistoryScreen({ onGo, entries = [], onClear, onRemove, onOpen, onResume }) {
  const [askClear, setAskClear] = useState(false);
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container history-page"><PageTitle eyebrow="YOUR RECENT SCREENINGS" title="Watch history" description="Written by real playback on this device." right={entries.length > 0 && <button className="subtle-action" onClick={() => setAskClear(true)}><Trash2 size={15} /> Clear history</button>} />
      {entries.length ? <div className="history-list">{entries.map((entry) => { const item = referenceToContent(entry.content); if (!item) return null; const resumable = !entry.completed && entry.percent > CONTINUE_MIN_PERCENT && entry.percent < CONTINUE_MAX_PERCENT; return <article className="history-row" key={entry.id}><button className="history-art" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}>{item.poster && <img src={item.poster} alt="" onError={(event) => event.currentTarget.remove()} />}<ProgressBar value={entry.percent || 0} /></button><div className="history-info" onClick={() => onOpen(item)}><span className="eyebrow">{entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : ''}</span><h2>{item.title}</h2><span>{entry.label || (item.type === 'series' ? 'Series' : 'Film')} <i>·</i> {Math.round(entry.percent || 0)}% watched{entry.duration ? ` · ${formatDuration(entry.duration)} long` : ''}</span>{entry.completed && <small>Finished</small>}</div><div className="history-row-actions">{resumable && <button className="history-resume" onClick={() => onResume(entry)}><Play size={13} fill="currentColor" /> Resume</button>}<button className="history-more" aria-label={`Remove ${item.title} from history`} onClick={() => onRemove(entry)}><X size={16} /></button></div></article>; })}</div> : <EmptyState icon={History} title="Your story starts here." description="No playback history has been recorded on this device." actionLabel="Browse catalog" onAction={() => onGo('discover')} />}
      </div>
      {askClear && <ConfirmDialog title="Clear your watch history?" description="This removes locally stored playback history. Your saved list won’t change." confirmLabel="Clear history" onCancel={() => setAskClear(false)} onConfirm={() => { onClear(); setAskClear(false); }} />}
    </main>
  );
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }) {
  return <div className="dialog-backdrop" role="presentation" onClick={onCancel}><section className="confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><span className="dialog-icon"><Trash2 size={19} /></span><h2>{title}</h2><p>{description}</p><div><button className="button button-outline" onClick={onCancel}>Cancel</button><button className="button button-danger" onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

function downloadStateCopy(entry) {
  switch (entry.state) {
    case 'starting': return { label: 'Checking the provider…', tone: 'busy', detail: 'Asking the download service for the first bytes. This stops after 20 seconds.' };
    case 'ready': return { label: 'Ready', tone: 'ready', detail: 'The provider answered. Tap Save file to hand the link to your device — the transfer itself depends on the provider.' };
    case 'unavailable': return { label: 'Unavailable', tone: 'warn', detail: entry.message || 'The provider’s download service is under maintenance and did not respond.' };
    default: return { label: 'Failed', tone: 'warn', detail: entry.message || 'The download request failed.' };
  }
}

function DownloadsScreen({ onGo, entries = [], onRetry, onSave, onRemove, notice = '', onDismissNotice }) {
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container downloads-page"><PageTitle eyebrow="OFFLINE MEDIA" title="Downloads" description="Only attempts you actually started are listed here." right={<span className="download-mode-pill"><WifiOff size={14} /> Best effort</span>} />
      <MaintenanceBanner message={notice} onDismiss={onDismissNotice} />
      {entries.length ? <div className="download-list">{entries.map((entry) => {
        const copy = downloadStateCopy(entry);
        const item = referenceToContent(entry.content);
        return <article className="download-card" key={entry.id}><span className="download-art">{item?.poster ? <img src={item.poster} alt="" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}</span><div className="download-info"><div className="download-title-line"><div><span className="eyebrow">{entry.state === 'ready' ? 'LINK VERIFIED' : entry.state === 'starting' ? 'IN PROGRESS' : 'NOT AVAILABLE'}</span><h2>{item?.title || 'Unknown title'}</h2><span>{[entry.label, entry.resolution, entry.startedAt ? new Date(entry.startedAt).toLocaleString() : ''].filter(Boolean).join(' · ')}</span></div><button className="download-more" aria-label="Dismiss this attempt" onClick={() => onRemove(entry)}><X size={16} /></button></div>
          <div className={`download-state download-state-${copy.tone}`}>{copy.tone === 'busy' ? <Loader2 size={14} /> : copy.tone === 'ready' ? <Check size={14} /> : <CloudOff size={14} />}<strong>{copy.label}</strong></div>
          <small>{copy.detail}</small>
          <div className="download-actions">
            {entry.state === 'ready' && <button className="download-play" onClick={() => onSave(entry)}><Download size={13} /> Save file</button>}
            {(entry.state === 'unavailable' || entry.state === 'failed') && <button onClick={() => onRetry(entry)}><RefreshCw size={13} /> Check again</button>}
          </div>
        </div></article>;
      })}</div> : <EmptyState icon={Download} title="No download attempts yet." description="Open a title and tap the download button. VEYRA asks the provider for a link and reports exactly what came back — it never fakes progress or files." actionLabel="Browse catalog" onAction={() => onGo('discover')} />}
      <p className="download-note"><CloudOff size={14} /> The provider’s proxy-download route is under maintenance and often hangs, so a 20-second check is all VEYRA does. Full offline files are not stored by this app.</p>
    </div></main>
  );
}

function ProfileScreen({ onGo, user, isOffline, historyCount, savedCount }) {
  const profileLinks = [
    { title: 'Continue watching', detail: 'Real playback positions only', icon: Play, route: 'continue' },
    { title: 'Watch history', detail: `${historyCount} recorded ${historyCount === 1 ? 'session' : 'sessions'}`, icon: History, route: 'history' },
    { title: 'My List', detail: `${savedCount} saved ${savedCount === 1 ? 'reference' : 'references'}`, icon: Heart, route: 'list' },
    { title: 'Downloads', detail: 'Real attempts and their provider results', icon: Download, route: 'downloads' },
  ];
  const settingsLinks = [
    { title: 'Preferences', detail: 'Language and appearance', icon: Settings, route: 'settings' },
    { title: 'Devices', detail: 'Device account service is not configured', icon: MonitorPlay, route: 'devices' },
    { title: 'Notifications', detail: 'No notification service is connected', icon: Bell, route: 'notifications' },
    { title: 'About VEYRA', detail: 'Version 1.0.0 · Made for stories', icon: CircleHelp, route: 'settings' },
  ];
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container profile-page"><PageTitle eyebrow="YOUR VEYRA" title="A little more you." description="Everything here is stored on this device." />
      <section className="profile-card"><div className="profile-avatar">{user?.name?.slice(0, 1)?.toUpperCase() || 'G'}<span /></div><div className="profile-identity"><span className="eyebrow">LOCAL PROFILE</span><h2>{user?.name || 'Guest'}</h2><p>{user?.email || 'No account service — preferences stay on this device'}</p></div><button className="profile-edit" onClick={() => onGo('settings')}>Preferences <ChevronRight size={15} /></button><div className="profile-plan"><VeyraMark size={18} /><span>VEYRA<small>LOCAL</small></span><i /> <strong>Catalog by ZST Labs</strong></div></section>
      <div className="profile-columns"><section><SectionLabel>YOUR LIBRARY</SectionLabel><div className="profile-link-list">{profileLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section><section><SectionLabel>APP & SERVICES</SectionLabel><div className="profile-link-list">{settingsLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section></div>
      <div className="profile-quick-actions"><button onClick={() => onGo('tv-home')}><Tv size={17} /><span><strong>Open TV experience</strong><small>Explore VEYRA on the big screen</small></span><ChevronRight size={16} /></button><div className="profile-link-row"><span className="profile-link-icon">{isOffline ? <WifiOff size={17} /> : <Wifi size={17} />}</span><span><strong>{isOffline ? 'Offline' : 'Online'}</strong><small>{isOffline ? 'No network connection detected' : 'Catalog API reachable'}</small></span></div></div>
    </div></main>
  );
}

function SettingsScreen({ onGo, settings, setSettings, historyCount, onClearHistory }) {
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const rows = [
    { title: 'Subtitle language', detail: 'Used to pick the default caption track', key: 'language', options: ['English', 'Español', 'Français', 'العربية'], icon: Languages },
    { title: 'Appearance', detail: 'Dark, or follow your device', key: 'appearance', options: ['Dark', 'System'], icon: Moon },
  ];
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container settings-page"><button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Profile</button><PageTitle eyebrow="MAKE IT YOURS" title="Settings" description="A few small things that stay on this device." />
      <section className="settings-group"><SectionLabel>APP PREFERENCES</SectionLabel>{rows.map(({ title, detail, key, options, icon: Icon }) => <div className="settings-row" key={key}><span className="setting-symbol"><Icon size={17} /></span><span className="setting-copy"><strong>{title}</strong><small>{detail}</small></span><label className="setting-select"><select aria-label={title} value={settings[key]} onChange={(event) => update(key, event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label></div>)}
      </section>
      <p className="settings-disclaimer">The language setting does not translate catalog titles or synopses — the provider returns one language. It only chooses the default subtitle track when that track exists.</p>
      <section className="settings-group"><SectionLabel>PLAYBACK</SectionLabel><p className="settings-disclaimer">Streams are progressive MP4 through the provider’s proxy, played in a standard video element. Stream links are signed and expire, so VEYRA requests a fresh /api/media link on every play and quality change. If a stream stalls or errors, VEYRA steps down to the next lower quality and then says “Source busy. Try again.”</p></section>
      <section className="settings-group"><SectionLabel>STORAGE</SectionLabel><p className="settings-disclaimer">{historyCount} playback {historyCount === 1 ? 'record' : 'records'} are stored locally in veyra-history:v2. My List and preferences live in localStorage on this device only.</p>{historyCount > 0 && <button className="settings-link-row" onClick={onClearHistory}><span className="setting-symbol"><Trash2 size={17} /></span><span className="setting-copy"><strong>Clear playback history</strong><small>Removes veyra-history:v2 from this device</small></span><ChevronRight size={17} /></button>}</section>
      <section className="settings-group"><SectionLabel>ACCOUNT & PRIVACY</SectionLabel><button className="settings-link-row" onClick={() => onGo('devices')}><span className="setting-symbol"><MonitorPlay size={17} /></span><span className="setting-copy"><strong>Manage devices</strong><small>No account/device service is connected</small></span><ChevronRight size={17} /></button><button className="settings-link-row" onClick={() => onGo('downloads')}><span className="setting-symbol"><HardDrive size={17} /></span><span className="setting-copy"><strong>Storage & downloads</strong><small>Best-effort provider links, checked live</small></span><ChevronRight size={17} /></button></section>
      <p className="settings-disclaimer">There is no user backend. VEYRA stores My List, history, downloads and preferences in this browser or app shell, and sends the ZST Labs API key from the build configuration on every catalog request.</p>
    </div></main>
  );
}

function DevicesScreen({ onGo }) {
  return <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container devices-page"><button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Profile</button><PageTitle eyebrow="YOUR CONNECTED CINEMAS" title="Devices" description="Device management requires an account service." /><EmptyState icon={MonitorPlay} title="No account service is connected." description="VEYRA has no user backend, so there are no device sessions to show — and none are invented." actionLabel="Back to profile" onAction={() => onGo('profile')} /></div></main>;
}

function NotificationsScreen({ onGo }) {
  return <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container notifications-page"><PageTitle eyebrow="A STORY WORTH A TAP" title="Notifications" description="Only connected services can create notifications." /><EmptyState icon={Bell} title="No notifications yet." description="The catalog API exposes no notification endpoint, so VEYRA has nothing to show here." actionLabel="Find a story" onAction={() => onGo('discover')} /></div></main>;
}

function OfflineScreen({ onGo, onTryAgain, downloadCount }) {
  return (
    <main className="offline-screen"><div className="offline-top"><Brand onClick={() => onGo('home')} /><span className="offline-mode"><span /> OFFLINE MODE</span></div><div className="offline-orbit" /><div className="offline-content"><span className="offline-icon"><WifiOff size={24} /></span><span className="eyebrow">A SMALL PAUSE</span><h1>You’re<br /><em>offline.</em></h1><p>Catalog requests need a connection. {downloadCount > 0 ? `You have ${downloadCount} download ${downloadCount === 1 ? 'attempt' : 'attempts'} recorded, but VEYRA stores no offline video files on this device.` : 'VEYRA stores no offline video files on this device.'}</p><ActionButton onClick={() => onGo('downloads')} icon={Download}>View downloads</ActionButton><button className="offline-retry" onClick={onTryAgain}><Wifi size={15} /> Try reconnecting</button></div><div className="offline-bottom"><span>Offline media is not configured</span><button onClick={() => onGo('profile')}>Profile <ArrowRight size={14} /></button></div></main>
  );
}

function TVHomeScreen({ onGo, onOpen, onPlay, onSearch, onProfile, featured, sections = [], loading, error, onRetry }) {
  const hero = featured || sections.flatMap((section) => section.items || [])[0] || null;
  return (
    <main className="tv-home-screen">
      <aside className="tv-sidebar"><Brand onClick={() => onGo('tv-home')} data-tv-focus="true" /><nav><button className="tv-nav-active" data-tv-focus="true" onClick={() => onGo('tv-home')}><span><Play size={18} /></span>Home</button><button data-tv-focus="true" onClick={onSearch}><span><Search size={18} /></span>Search</button><button data-tv-focus="true" onClick={() => onGo('list')}><span><Heart size={18} /></span>My List</button><button data-tv-focus="true" onClick={onProfile}><span><UserRound size={18} /></span>Profile</button></nav><div className="tv-sidebar-bottom"><span className="tv-avatar">G</span><span>Guest</span><button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ArrowRight size={14} /></button></div></aside>
      <div className="tv-main"><div className="tv-topline"><span className="tv-now"><span /> {loading ? 'CONNECTING TO CATALOG' : error ? 'CATALOG UNAVAILABLE' : 'YOUR EVENING, CURATED'}</span><div><span className="tv-clock">VEYRA</span><button data-tv-focus="true" onClick={onProfile} aria-label="Open profile"><UserRound size={17} /></button></div></div>
        <section className="tv-feature" style={{ '--feature-art': hero?.backdrop ? `url('${hero.backdrop}')` : 'none' }}><div className="tv-feature-wash" /><div className="tv-feature-copy"><span className="eyebrow"><VeyraMark size={14} /> {hero ? 'FROM YOUR CATALOG' : 'YOUR PRIVATE CINEMA'}</span><h1>{hero ? hero.title : <>Your next<br /><em>story.</em></>}</h1><p>{hero?.synopsis || error || (loading ? 'Finding stories from your catalog.' : 'The catalog API is not reachable right now.')}</p><div className="tv-meta">{hero?.rating && <span><Star size={13} fill="currentColor" /> {hero.rating}</span>}{hero?.year && <span>{hero.year}</span>}{hero?.runtime && <span>{hero.runtime}</span>}</div><div className="tv-feature-actions">{hero ? <><button className="button button-primary" data-tv-focus="true" onClick={() => onPlay(hero)}><Play size={16} fill="currentColor" /> Watch</button><button className="button button-glass" data-tv-focus="true" onClick={() => onOpen(hero)}>Explore title <ArrowRight size={15} /></button></> : <><button className="button button-primary" data-tv-focus="true" onClick={onSearch}><Search size={16} /> Search catalog</button>{error && <button className="button button-glass" data-tv-focus="true" onClick={onRetry}>Try again</button>}</>}</div></div><span className="tv-feature-aside">VEYRA <i>CATALOG</i></span></section>
        {error && sections.length > 0 && <div className="tv-catalog-warning"><ErrorState title="Some catalog sections are unavailable." description={error} onRetry={onRetry} /></div>}
        <section className="tv-rails">{loading ? <SkeletonRows count={3} /> : sections.map((section) => <ContentRail key={section.id} title={section.title} items={section.items} onItemClick={onOpen} tvFocus compact actionLabel="" />)}</section>
      </div><div className="tv-remote-hint tv-home-hint"><span>↑↓ MOVE</span><span>OK SELECT</span><span>BACK RETURN</span></div>
    </main>
  );
}

function TVProfile({ onGo }) {
  return <div className="tv-profile-popover"><div className="tv-avatar">G</div><strong>Guest</strong><small>Local profile · no account service</small><button data-tv-focus="true" onClick={() => onGo('profile')}>Preferences <ChevronRight size={14} /></button><button data-tv-focus="true" onClick={() => onGo('devices')}>Devices <ChevronRight size={14} /></button><button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ArrowRight size={14} /></button></div>;
}

export {
  HomeScreen,
  DiscoverScreen,
  SearchScreen,
  DetailScreen,
  PlayerScreen,
  MyListScreen,
  ContinueScreen,
  HistoryScreen,
  DownloadsScreen,
  ProfileScreen,
  SettingsScreen,
  TVHomeScreen,
};

export default function App() {
  const [view, setView] = useState(() => initialRoute());
  const [showSplash, setShowSplash] = useState(true);
  const [selectedTitle, setSelectedTitle] = useState(null);
  const [detailFrom, setDetailFrom] = useState('home');
  const [playerFrom, setPlayerFrom] = useState('home');
  const [playback, setPlayback] = useState(null);
  const [homeData, setHomeData] = useState({ loading: true, error: '', featured: null, sections: [], notice: '' });
  const [noticeDismissed, setNoticeDismissed] = useState(false);
  const [savedItems, setSavedItems] = useState(readSavedReferences);
  const [history, setHistory] = useState(readHistory);
  const [downloads, setDownloads] = useState(readDownloads);
  const [settings, setSettings] = useState(readSettings);
  const [user] = useState({ name: 'Guest', email: '' });
  const [selectedType, setSelectedType] = useState('all');
  const [toast, setToast] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const [tvProfileOpen, setTvProfileOpen] = useState(false);
  const toastTimer = useRef(null);
  const pushedRef = useRef(0);

  /* ---------------- catalog ---------------- */
  const loadHome = useCallback(async (signal) => {
    setHomeData((current) => ({ ...current, loading: true, error: '' }));
    const results = await Promise.allSettled([
      movieBoxClient.getHomepage({ signal }),
      movieBoxClient.getTrending({ page: 0, perPage: 18, signal }),
      movieBoxClient.getHotMoviesAndSeries({ signal }),
    ]);
    if (signal?.aborted) return;

    const sections = [];
    const addSection = (title, items) => {
      const normalizedItems = uniqueItems(items || []);
      if (!normalizedItems.length) return;
      sections.push({ id: `api-section:${title}`, title, items: normalizedItems });
    };

    let notice = '';
    const homepage = results[0];
    if (homepage.status === 'fulfilled') {
      notice = extractNotice(homepage.value);
      const homepageSections = extractContentSections(homepage.value);
      homepageSections.forEach((section) => addSection(section.title, section.items));
      if (!homepageSections.length) addSection('Featured from your catalog', extractContentList(homepage.value));
    }
    const trending = results[1];
    if (trending.status === 'fulfilled') addSection('Trending now', extractContentList(trending.value));
    const hot = results[2];
    if (hot.status === 'fulfilled') addSection('Hot movies & series', extractContentList(hot.value));

    const catalog = uniqueItems(sections.flatMap((section) => section.items));
    const failures = results.filter((result) => result.status === 'rejected');
    const failureMessages = [...new Set(failures.map((result) => describeError(result.reason)).filter(Boolean))];
    let error = '';
    if (failures.length === results.length) error = failureMessages[0] || 'The catalog could not be loaded.';
    else if (!catalog.length) error = 'The API responded, but returned no titles with the identifiers and fields VEYRA needs.';
    else if (failures.length) error = `Some catalog sections could not be loaded. ${failureMessages.join(' ')}`;
    setHomeData({ loading: false, error, featured: catalog[0] || null, sections, catalog, notice });
    if (notice) setNoticeDismissed(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadHome(controller.signal);
    return () => controller.abort();
  }, [loadHome]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 700);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => writeStore(LIST_KEY, savedItems), [savedItems]);
  useEffect(() => writeStore(HISTORY_KEY, history), [history]);
  useEffect(() => writeStore(DOWNLOADS_KEY, downloads), [downloads]);
  useEffect(() => writeStore(SETTINGS_KEY, settings), [settings]);

  /* ---------------- appearance (Dark / System) ---------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const query = window.matchMedia?.('(prefers-color-scheme: light)');
    const apply = () => {
      const light = settings.appearance === 'System' && Boolean(query?.matches);
      document.documentElement.dataset.theme = light ? 'light' : 'dark';
    };
    apply();
    if (!query?.addEventListener) return undefined;
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, [settings.appearance]);

  /* ---------------- navigation (Android/TV back aware) ---------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.history.replaceState({ ...(window.history.state || {}), veyra: initialRoute() }, '');
    const onPop = (event) => {
      if (pushedRef.current > 0) pushedRef.current -= 1;
      const state = event.state || {};
      setTvProfileOpen(false);
      // Restore the exact screen the entry was created from, so back from a
      // second title (or from the player) lands on what was actually open.
      if (state.detailFrom) setDetailFrom(state.detailFrom);
      if (state.title) setSelectedTitle(state.title);
      if (state.playback) setPlayback(state.playback);
      if (state.playerFrom) setPlayerFrom(state.playerFrom);
      setView(state.veyra || 'home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((destination, state = {}) => {
    setView(destination);
    setTvProfileOpen(false);
    if (typeof window !== 'undefined') {
      window.history.pushState({ veyra: destination, ...state }, '');
      pushedRef.current += 1;
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, []);
  const go = navigate;

  const goBack = useCallback((fallback) => {
    if (typeof window !== 'undefined' && pushedRef.current > 0) {
      window.history.back();
      return;
    }
    setView(fallback || 'home');
  }, []);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3600);
  }, []);

  useEffect(() => {
    const onOffline = () => { setIsOffline(true); setView('offline'); };
    const onOnline = () => setIsOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); };
  }, []);

  useEffect(() => {
    const shortcut = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        go('search');
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [go]);

  const dismissToast = () => { setToast(''); window.clearTimeout(toastTimer.current); };
  const onSearch = () => go('search');

  const onOpenTitle = (item) => {
    if (!item) return;
    const from = view === 'detail' || view === 'tv-detail' ? detailFrom : view;
    setDetailFrom(from);
    setSelectedTitle(item);
    navigate(from.startsWith('tv') ? 'tv-detail' : 'detail', { title: item, detailFrom: from });
  };
  const goBackFromDetail = () => goBack(detailFrom || 'home');

  const startPlayer = (item = selectedTitle, episode = null, seasonNumber = null, position = 0) => {
    const target = item || selectedTitle;
    if (!target) return;
    const payload = { content: target, episode, season: seasonNumber, startPosition: position };
    setPlayback(payload);
    setPlayerFrom(view);
    navigate(view.startsWith('tv') ? 'tv-player' : 'player', { playback: payload, playerFrom: view });
  };

  /* ---------------- history ---------------- */
  const recordPlayback = useCallback(({ content, season, episode, label, position, duration, percent, completed }) => {
    if (!content?.id) return;
    const reference = contentReference(content);
    const id = `${content.id}::${season ?? 0}:${episode ?? 0}`;
    const entry = {
      id,
      content: reference,
      season: season ?? null,
      episode: episode ?? null,
      label: label || (season !== null && episode !== null ? `Season ${season} · Episode ${episode}` : ''),
      position: Math.max(0, Number(position) || 0),
      duration: Number(duration) || 0,
      percent: Math.max(0, Math.min(100, Number(percent) || 0)),
      completed: Boolean(completed),
      updatedAt: new Date().toISOString(),
    };
    setHistory((current) => [entry, ...current.filter((item) => item.id !== entry.id)].slice(0, HISTORY_LIMIT));
  }, []);

  const continueEntries = useMemo(() => history
    .filter((entry) => entry.content && !entry.completed && entry.percent > CONTINUE_MIN_PERCENT && entry.percent < CONTINUE_MAX_PERCENT)
    .map((entry) => {
      const content = referenceToContent(entry.content);
      return {
        id: entry.id,
        content,
        percent: entry.percent,
        label: entry.label,
        position: entry.position,
        season: entry.season,
        episode: entry.episode,
        remainingLabel: `${minutesLeft(entry.position, entry.duration)} min left`,
      };
    })
    .filter((entry) => entry.content), [history]);

  const resumeEntry = (entry) => {
    const content = entry.content;
    const episode = entry.season !== null && entry.episode !== null
      ? { apiSeason: entry.season, apiEpisode: entry.episode, episodeNo: entry.episode, number: entry.episode, title: entry.label || `Episode ${entry.episode}` }
      : null;
    startPlayer(content, episode, entry.season, entry.position || 0);
  };

  const progressFor = useCallback((contentId, seasonValue, episodeValue) => history.find((entry) => (
    entry.content?.id === contentId
    && String(entry.season ?? '') === String(seasonValue ?? '')
    && String(entry.episode ?? '') === String(episodeValue ?? '')
  )), [history]);

  /* ---------------- downloads ---------------- */
  const updateDownload = (id, patch) => setDownloads((current) => current.map((entry) => (entry.id === id ? { ...entry, ...patch, updatedAt: new Date().toISOString() } : entry)));

  const runDownloadCheck = useCallback(async (record) => {
    updateDownload(record.id, { state: 'starting', message: '' });
    try {
      const payload = await movieBoxClient.getMedia({
        subjectId: record.content.providerItemId,
        detailPath: record.content.detailPath,
        season: record.season ?? 0,
        episode: record.episode ?? 0,
        fresh: true,
      });
      const media = normalizeMedia(payload);
      const quality = media.qualities.find((entry) => entry.downloadUrl) || media.qualities[0];
      if (!media.hasResource || !quality) {
        updateDownload(record.id, { state: 'unavailable', message: 'The provider returned no downloadable source for this selection.' });
        return;
      }
      if (!quality.downloadUrl) {
        updateDownload(record.id, { state: 'unavailable', message: `The provider returned a ${quality.label} stream but no download link for it.` });
        return;
      }
      const probe = await probeDownloadAvailability(quality.downloadUrl, { timeoutMs: DOWNLOAD_TIMEOUT_MS });
      if (probe.available) {
        updateDownload(record.id, { state: 'ready', resolution: quality.label, downloadUrl: quality.downloadUrl, message: '' });
      } else if (probe.reason === 'TIMEOUT') {
        updateDownload(record.id, { state: 'unavailable', resolution: quality.label, message: 'The provider’s download service did not respond within 20 seconds. Its proxy-download route is under maintenance, so downloads are unavailable right now.' });
      } else {
        updateDownload(record.id, { state: 'failed', resolution: quality.label, message: `The download request failed (${probe.reason}).` });
      }
    } catch (error) {
      updateDownload(record.id, { state: 'failed', message: describeError(error) });
    }
  }, []);

  const startDownload = (content, options = {}) => {
    if (!content?.providerItemId && !content?.detailPath) {
      notify('This title has no provider reference to download.');
      return;
    }
    const reference = contentReference(content);
    const id = `${content.id}::${options.season ?? 0}:${options.episode ?? 0}::${Date.now()}`;
    const record = {
      id,
      content: reference,
      season: options.season ?? 0,
      episode: options.episode ?? 0,
      label: options.label || '',
      state: 'starting',
      resolution: null,
      downloadUrl: '',
      message: '',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setDownloads((current) => [record, ...current].slice(0, 40));
    notify(`Checking the provider for ${content.title}…`);
    runDownloadCheck(record);
    go('downloads');
  };

  const saveDownload = (record) => {
    if (!record.downloadUrl) return;
    try {
      const link = document.createElement('a');
      link.href = record.downloadUrl;
      link.rel = 'noreferrer';
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
      notify('Handed the provider link to your device. The transfer depends on the provider.');
    } catch {
      notify('This device could not start the download.');
    }
  };

  const toggleSaved = (item) => {
    if (!item?.id) return;
    const alreadySaved = savedItems.some((entry) => entry.id === item.id);
    setSavedItems((current) => alreadySaved
      ? current.filter((entry) => entry.id !== item.id)
      : [contentReference(item), ...current]);
    notify(alreadySaved ? `${item.title} removed from My List` : `${item.title} added to My List`);
  };
  const isSaved = (id) => savedItems.some((item) => item.id === id);

  const catalogItems = useMemo(() => uniqueItems(homeData.sections.flatMap((section) => section.items || [])), [homeData.sections]);
  const continueItems = continueEntries.map((entry) => entry.content);
  const showNotice = homeData.notice && !noticeDismissed;
  const isPlayerView = view === 'player' || view === 'tv-player';

  /* ---------------- TV remote ---------------- */
  useEffect(() => {
    if (!view.startsWith('tv') || isPlayerView) return undefined;
    const focusTimer = window.setTimeout(() => {
      const selector = view === 'tv-home' ? '.tv-feature-actions [data-tv-focus="true"]' : view === 'tv-detail' ? '.detail-actions [data-tv-focus="true"]' : '[data-tv-focus="true"]';
      document.querySelector(selector)?.focus({ preventScroll: true });
    }, 90);
    const handleRemote = (event) => {
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(event.key)) {
        event.preventDefault();
        const items = Array.from(document.querySelectorAll('[data-tv-focus="true"]:not([disabled])'));
        if (!items.length) return;
        const currentIndex = items.indexOf(document.activeElement);
        const direction = ['ArrowDown', 'ArrowRight'].includes(event.key) ? 1 : -1;
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + direction + items.length) % items.length;
        items[nextIndex].focus({ preventScroll: true });
        items[nextIndex].scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
      }
      if (event.key === 'Enter' && document.activeElement?.matches('[data-tv-focus="true"]')) {
        event.preventDefault();
        document.activeElement.click();
      }
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        if (view === 'tv-detail') goBackFromDetail();
        else if (view === 'tv-home') go('home');
        else goBack('tv-home');
      }
    };
    document.addEventListener('keydown', handleRemote);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener('keydown', handleRemote); };
  }, [view, detailFrom, playerFrom, goBack, goBackFromDetail, isPlayerView, go]);

  /* ---------------- global back (Android / keyboard) ---------------- */
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handleBack = (event) => {
      if (event.key !== 'Escape' && event.key !== 'Backspace') return;
      const tag = event.target?.tagName;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) return;
      if (isPlayerView || view.startsWith('tv')) return; // the player/TV views own their own back handling
      if (document.querySelector('.dialog-backdrop')) return;
      event.preventDefault();
      if (view === 'detail') goBackFromDetail();
      else goBack('home');
    };
    window.addEventListener('keydown', handleBack);
    return () => window.removeEventListener('keydown', handleBack);
  }, [view, isPlayerView, goBack, goBackFromDetail]);

  const homeProps = {
    onGo: go,
    onSearch,
    onNotifications: () => go('notifications'),
    onProfile: () => go('profile'),
    onOpen: onOpenTitle,
    onPlay: (item) => {
      const entry = continueEntries.find((candidate) => candidate.content.id === item?.id);
      if (entry) resumeEntry(entry);
      else startPlayer(item);
    },
    isSaved,
    onToggleSaved: toggleSaved,
    featured: homeData.featured,
    sections: homeData.sections,
    progressItems: continueItems,
    progressFor: (id) => history.find((entry) => entry.content?.id === id)?.percent,
    loading: homeData.loading,
    error: homeData.error,
    notice: showNotice ? homeData.notice : '',
    onDismissNotice: () => setNoticeDismissed(true),
    onRetry: () => loadHome(),
  };

  let screen;
  if (view === 'home') {
    screen = <HomeScreen {...homeProps} />;
  } else if (view === 'discover') {
    screen = <DiscoverScreen onGo={go} onOpen={onOpenTitle} selectedType={selectedType} setSelectedType={setSelectedType} sections={homeData.sections} items={catalogItems} loading={homeData.loading} error={homeData.error} onRetry={() => loadHome()} />;
  } else if (view === 'search') {
    screen = <SearchScreen onGo={go} onOpen={onOpenTitle} />;
  } else if (view === 'detail' || view === 'tv-detail') {
    screen = <DetailScreen item={selectedTitle} onBack={goBackFromDetail} onPlay={(content, episode, seasonValue) => startPlayer(content, episode, seasonValue)} onToggleSaved={toggleSaved} isSaved={isSaved} onDownload={(content, info) => startDownload(content, info)} onOpen={onOpenTitle} isTV={view === 'tv-detail'} progressFor={progressFor} />;
  } else if (isPlayerView) {
    screen = playback
      ? <PlayerScreen content={playback.content} episode={playback.episode} season={playback.season} startPosition={playback.startPosition} onBack={() => goBack(playerFrom || 'home')} onProgress={recordPlayback} preferredLanguage={settings.language} isTV={view === 'tv-player'} />
      : <HomeScreen {...homeProps} />;
  } else if (view === 'list') {
    screen = <MyListScreen onGo={go} onOpen={onOpenTitle} savedItems={savedItems} onRemove={(item) => { setSavedItems((current) => current.filter((entry) => entry.id !== item.id)); notify(`${item.title} removed from My List`); }} />;
  } else if (view === 'continue') {
    screen = <ContinueScreen onGo={go} onOpen={onOpenTitle} onPlay={resumeEntry} items={continueEntries} />;
  } else if (view === 'history') {
    screen = <HistoryScreen onGo={go} entries={history} onClear={() => setHistory([])} onRemove={(entry) => setHistory((current) => current.filter((item) => item.id !== entry.id))} onOpen={onOpenTitle} onResume={resumeEntry} />;
  } else if (view === 'downloads') {
    screen = <DownloadsScreen onGo={go} entries={downloads} notice={showNotice ? homeData.notice : ''} onDismissNotice={() => setNoticeDismissed(true)} onRetry={(entry) => runDownloadCheck(entry)} onSave={saveDownload} onRemove={(entry) => setDownloads((current) => current.filter((item) => item.id !== entry.id))} />;
  } else if (view === 'profile') {
    screen = <ProfileScreen onGo={go} user={user} isOffline={isOffline} historyCount={history.length} savedCount={savedItems.length} />;
  } else if (view === 'settings') {
    screen = <SettingsScreen onGo={go} settings={settings} setSettings={setSettings} historyCount={history.length} onClearHistory={() => { setHistory([]); notify('Playback history cleared.'); }} />;
  } else if (view === 'devices') {
    screen = <DevicesScreen onGo={go} />;
  } else if (view === 'notifications') {
    screen = <NotificationsScreen onGo={go} />;
  } else if (view === 'offline') {
    screen = <OfflineScreen onGo={go} downloadCount={downloads.length} onTryAgain={() => {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      setIsOffline(!online);
      if (online) { go('home'); loadHome(); }
      else notify('This device is still offline.');
    }} />;
  } else if (view === 'tv-home') {
    screen = <TVHomeScreen onGo={go} onOpen={onOpenTitle} onPlay={(item) => startPlayer(item)} onSearch={onSearch} onProfile={() => setTvProfileOpen((value) => !value)} featured={homeData.featured} sections={homeData.sections} loading={homeData.loading} error={homeData.error} onRetry={() => loadHome()} />;
  } else {
    screen = <HomeScreen {...homeProps} />;
  }

  const showBottomNav = ['home', 'discover', 'search', 'list', 'profile', 'continue', 'history', 'downloads', 'settings', 'devices', 'notifications'].includes(view);
  const navActive = ['home', 'discover'].includes(view) ? 'home' : view === 'search' ? 'search' : view === 'list' ? 'list' : ['profile', 'continue', 'history', 'downloads', 'settings', 'devices', 'notifications'].includes(view) ? 'profile' : '';
  return (
    <div className={`app-shell ${view.startsWith('tv') ? 'app-tv-mode' : ''}`}>
      {screen}
      {showBottomNav && <BottomNav active={navActive} onGo={(destination) => go(destination)} />}
      {view === 'tv-home' && tvProfileOpen && <TVProfile onGo={go} />}
      {isOffline && view !== 'offline' && <button className="offline-indicator" onClick={() => go('offline')}><WifiOff size={13} /> Offline</button>}
      <Toast message={toast} onClose={dismissToast} />
      {showSplash && <div className="splash-screen"><VeyraMark size={46} /><span>VEYRA</span><small>WATCH WHAT MOVES YOU</small><i /></div>}
      <span className="sr-only" aria-live="polite">{toast}</span>
    </div>
  );
}
