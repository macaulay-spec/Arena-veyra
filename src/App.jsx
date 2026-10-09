import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Compass,
  Download,
  Film,
  HardDrive,
  Heart,
  History,
  Languages,
  Layers,
  MonitorPlay,
  Moon,
  Play,
  Plus,
  Search,
  Settings,
  Share2,
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
  Avatar,
  BackButton,
  BottomNav,
  Brand,
  ContentRail,
  DetailSkeleton,
  EmptyState,
  EpisodeSkeleton,
  ErrorState,
  GridSkeleton,
  HeroCarousel,
  HeroSkeleton,
  ListSkeleton,
  PageTitle,
  PosterCard,
  ProgressBar,
  RailSkeleton,
  RecentSearches,
  SearchEmpty,
  TopBar,
  VeyraMark,
} from './components';
import { genres } from './data';
import Player from './Player';
import { copy, friendlyError, metaLine } from './copy';
import { moveFocus } from './tv';
import { catalogApi } from './services/catalog';
import { contentReference, restoreReference } from './services/api/normalize';
import { resolveDownload } from './services/media';
import {
  DOWNLOAD_STATES,
  DownloadManager,
  downloadCapability,
  downloadProgress,
  formatBytes,
} from './services/downloads';
import {
  STORAGE_KEYS,
  continueWatching,
  episodeCode,
  formatRemaining,
  historyId,
  loadLibrary,
  loadSettings,
  nextEpisode,
  progressPercent,
  recentSearches as withSearchTerm,
  resumeTarget,
  saveSettings,
  sortedHistory,
  upsertHistory,
  writeJson,
} from './services/library';
import './styles.css';
import './theme.css';

const DEFAULT_SETTINGS = {
  appearance: 'Dark',
  autoplayNext: true,
  subtitles: false,
  dataSaver: false,
  preferredQuality: 'Auto',
  subtitleLanguage: 'English',
};

const BOTTOM_NAV_VIEWS = new Set(['home', 'discover', 'search', 'list', 'profile']);

function safeRead(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function storedList() {
  const stored = typeof window === 'undefined' ? [] : safeRead(STORAGE_KEYS.list, []);
  if (!Array.isArray(stored)) return [];
  const seen = new Set();
  return stored.map(restoreReference).filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => item?.id && !seen.has(item.id) && seen.add(item.id));
}

function initialRoute() {
  if (typeof navigator === 'undefined') return 'home';
  return /Android TV|Google TV|Leanback|AFT|SHIELD TV|BRAVIA/i.test(navigator.userAgent) ? 'tv-home' : 'home';
}

function relativeDay(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function deviceName() {
  if (typeof navigator === 'undefined') return 'This device';
  const ua = navigator.userAgent;
  if (/Android TV|Google TV|Leanback/i.test(ua)) return 'Android TV';
  if (/Android/i.test(ua)) return 'Android phone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/iPhone/i.test(ua)) return 'iPhone';
  return 'This browser';
}

function Toast({ message, onClose }) {
  if (!message) return null;
  return (
    <div className="toast" role="status">
      <span className="toast-check"><Check size={15} /></span>
      <span>{message}</span>
      <button onClick={onClose} aria-label="Dismiss"><X size={14} /></button>
    </div>
  );
}

function Dialog({ title, description, confirmLabel = 'Close', onConfirm, children }) {
  return (
    <div className="dialog-backdrop" role="presentation" onClick={onConfirm}>
      <section className="confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
        {children}
        <div><button className="button button-primary" onClick={onConfirm}>{confirmLabel}</button></div>
      </section>
    </div>
  );
}

function WelcomeScreen({ onStart, onSignIn }) {
  return (
    <main className="welcome-screen">
      <div className="welcome-art" aria-hidden="true" />
      <div className="welcome-wash" />
      <header className="welcome-top"><Brand onClick={onStart} /></header>
      <div className="welcome-content">
        <span className="eyebrow">A private cinema</span>
        <h1>Watch what<br /><em>moves you.</em></h1>
        <p>Films, series and the stories you keep coming back to — on your phone and on your TV.</p>
        <div className="welcome-actions">
          <button className="button button-primary" onClick={onStart}>Get started</button>
          <button className="button button-quiet" onClick={onSignIn}>I already have an account</button>
        </div>
      </div>
      <footer className="welcome-footer"><span>VEYRA</span><i /><span>One library, every screen</span></footer>
    </main>
  );
}

function HomeScreen({
  onGo, onSearch, onNotifications, onProfile, onOpen, onPlay, onToggleSaved, isSaved,
  featured = [], sections = [], continueItems = [], loading, error, onRetry, user, playerLabel,
}) {
  const hasContent = featured.length > 0 || sections.length > 0;
  return (
    <main className="home-page">
      <TopBar isHome active="home" onGo={onGo} onSearch={onSearch} onNotifications={onNotifications} onProfile={onProfile} user={user} />
      {loading && !hasContent ? <HeroSkeleton /> : featured.length > 0 ? (
        <HeroCarousel
          items={featured}
          isSaved={isSaved}
          onToggleSaved={onToggleSaved}
          onOpen={onOpen}
          onPlay={onPlay}
          primaryLabel={playerLabel}
        />
      ) : (
        <section className="hero hero-quiet">
          <div className="hero-wash" />
          <div className="hero-content">
            <span className="hero-kicker"><VeyraMark size={15} /> VEYRA</span>
            <h1>Your next<br /><em>story.</em></h1>
            <p className="hero-description">Your cinema is ready. Titles appear here as soon as they are available.</p>
            <div className="hero-actions">
              <button className="button button-primary" onClick={onSearch}><Search size={16} /> Find something to watch</button>
              {error && <button className="button button-quiet" onClick={onRetry}>{copy.actions.retry}</button>}
            </div>
          </div>
        </section>
      )}

      <div className="home-content">
        {continueItems.length > 0 && (
          <ContentRail
            title="Continue watching"
            eyebrow="Pick up where you left off"
            items={continueItems}
            onItemClick={onOpen}
            onPlayItem={onPlay}
            progressFor={(id) => continueItems.find((item) => item.id === id)?.progress}
            actionLabel="See all"
            onAction={() => onGo('continue')}
          />
        )}
        {loading && !sections.length && <><RailSkeleton count={5} /><RailSkeleton count={5} /></>}
        {!loading && error && !hasContent && <ErrorState title={copy.errors.home} description={error} onRetry={onRetry} />}
        {!loading && error && hasContent && <ErrorState title="Some rows are missing." description={error} onRetry={onRetry} />}
        {sections.map((section) => (
          <ContentRail key={section.id} title={section.title} items={section.items} onItemClick={onOpen} onPlayItem={onPlay} />
        ))}
        {loading && <RailSkeleton count={5} />}
        {!loading && !error && !hasContent && (
          <EmptyState
            icon={Compass}
            eyebrow="Nothing here yet"
            title="Your library is waiting."
            description="As soon as titles are available they will fill this screen."
            actionLabel="Discover"
            onAction={() => onGo('discover')}
          />
        )}
        <div className="home-footer"><Brand compact onClick={() => onGo('home')} /><span>Stories worth staying for.</span><button onClick={() => onGo('settings')}>Preferences</button></div>
      </div>
    </main>
  );
}

function DiscoverScreen({ onGo, onOpen, onPlay, selectedType, setSelectedType, sections = [], items = [], loading, error, onRetry, user }) {
  const [genre, setGenre] = useState('All');
  const matches = useCallback((item) => {
    const matchesType = selectedType === 'all' || item.type === selectedType;
    const matchesGenre = genre === 'All' || item.genres?.some((value) => value.toLowerCase() === genre.toLowerCase());
    return matchesType && matchesGenre;
  }, [selectedType, genre]);
  const visible = items.filter(matches);
  const availableGenres = useMemo(() => {
    const found = new Set(genres);
    items.forEach((item) => (item.genres || []).forEach((value) => found.add(value)));
    return Array.from(found).slice(0, 14);
  }, [items]);
  return (
    <main className="page-screen discover-screen">
      <TopBar active="discover" onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container discover-content">
        <div className="discover-intro">
          <span className="eyebrow">Explore</span>
          <h1>Find your next<br /><em>obsession.</em></h1>
          <p>Browse by mood, genre or whatever everyone is talking about.</p>
          <div className="discover-orbit orbit-one" /><div className="discover-orbit orbit-two" />
          <span className="discover-stamp">CURATED<br />FOR YOU <Sparkles size={14} /></span>
        </div>
        <div className="discover-controls">
          <div className="segmented" role="tablist" aria-label="Content type">
            {[['all', 'Everything'], ['movie', 'Movies'], ['series', 'Series']].map(([id, label]) => (
              <button key={id} className={selectedType === id ? 'selected' : ''} onClick={() => setSelectedType(id)} role="tab" aria-selected={selectedType === id}>{label}</button>
            ))}
          </div>
          <div className="genre-scroll" role="tablist" aria-label="Genres">
            {availableGenres.map((item) => (
              <button key={item} className={`genre-chip ${genre === item ? 'genre-active' : ''}`} onClick={() => setGenre(item)} role="tab" aria-selected={genre === item}>{item}</button>
            ))}
          </div>
        </div>
        {loading && !items.length ? <GridSkeleton count={9} /> : error && !items.length ? (
          <ErrorState title={copy.errors.discover} description={error} onRetry={onRetry} />
        ) : (
          <>
            {error && items.length > 0 && <ErrorState title="Some rows are missing." description={error} onRetry={onRetry} />}
            {sections.slice(0, 3).map((section) => {
              const sectionItems = section.items.filter(matches);
              return sectionItems.length ? <ContentRail key={section.id} title={section.title} items={sectionItems} onItemClick={onOpen} onPlayItem={onPlay} /> : null;
            })}
            <section className="discover-filtered">
              <div className="rail-heading">
                <div><h2>{genre === 'All' ? (selectedType === 'movie' ? 'Movies' : selectedType === 'series' ? 'Series' : 'Everything we have') : `${genre} picks`}</h2></div>
                <span className="result-count">{visible.length} {visible.length === 1 ? 'title' : 'titles'}</span>
              </div>
              {visible.length ? (
                <div className="poster-grid discover-grid">
                  {visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} onPlay={onPlay} />)}
                </div>
              ) : (
                <EmptyState
                  icon={Compass}
                  eyebrow="Nothing matching"
                  title="No titles here yet."
                  description="Try another genre or switch between Movies and Series."
                  actionLabel={error ? copy.actions.retry : 'Show everything'}
                  onAction={error ? onRetry : () => { setGenre('All'); setSelectedType('all'); }}
                />
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function SearchScreen({ onGo, onOpen, onPlay, recent = [], onRememberSearch, onClearRecent, user }) {
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState('ALL');
  const [page, setPage] = useState(1);
  const [retryVersion, setRetryVersion] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [found, setFound] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [popular, setPopular] = useState([]);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    if (!term) {
      setLoading(false); setError(''); setFound([]); setSuggestions([]); setCanLoadMore(false);
      return () => controller.abort();
    }
    setLoading(true);
    if (page === 1) setError('');
    const timer = window.setTimeout(async () => {
      const [searchResult, suggestionResult] = await Promise.allSettled([
        catalogApi.search({ query: term, subjectType: scope, page, perPage: 24, signal: controller.signal }),
        page === 1 ? catalogApi.getSuggestions({ query: term, signal: controller.signal }) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      if (searchResult.status === 'fulfilled') {
        const pageItems = searchResult.value.items;
        setFound((current) => (page === 1 ? pageItems : uniqueById([...current, ...pageItems])));
        setCanLoadMore(Boolean(searchResult.value.pager?.hasMore));
        if (page === 1) setError('');
      } else {
        if (page === 1) setFound([]);
        setCanLoadMore(false);
        setError(friendlyError(searchResult.reason, copy.errors.search));
      }
      if (page === 1) setSuggestions(suggestionResult.status === 'fulfilled' ? suggestionResult.value : []);
      setLoading(false);
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, scope, page, retryVersion]);

  useEffect(() => {
    if (query.trim()) return undefined;
    const controller = new AbortController();
    catalogApi.getPopularSearches({ signal: controller.signal })
      .then((terms) => setPopular(terms.slice(0, 8)))
      .catch(() => setPopular([]));
    return () => controller.abort();
  }, [query]);

  const changeQuery = (value) => { setQuery(value); setPage(1); setCanLoadMore(false); };
  const submit = () => { const term = query.trim(); if (term) onRememberSearch?.(term); };
  const visible = found.filter((item) => scope === 'ALL' || (scope === 'MOVIES' ? item.type === 'movie' : item.type === 'series'));
  const movies = visible.filter((item) => item.type === 'movie');
  const series = visible.filter((item) => item.type === 'series');
  const other = visible.filter((item) => !item.type);

  return (
    <main className="page-screen search-screen">
      <TopBar onGo={onGo} onSearch={() => searchRef.current?.focus()} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container search-content">
        <div className="search-heading"><span className="eyebrow">Search</span><h1>What are you<br /><em>in the mood for?</em></h1></div>
        <form className="search-field-wrap" role="search" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          <Search size={20} />
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => changeQuery(event.target.value)}
            placeholder="Search movies and series"
            aria-label="Search movies and series"
            enterKeyHint="search"
          />
          {query && <button type="button" onClick={() => changeQuery('')} aria-label="Clear search"><X size={17} /></button>}
        </form>
        <div className="search-scopes" role="tablist" aria-label="Search in">
          {[['ALL', 'Everything'], ['MOVIES', 'Movies'], ['TV_SERIES', 'Series']].map(([id, label]) => (
            <button key={id} className={scope === id ? 'scope-active' : ''} onClick={() => { setScope(id); setPage(1); }} role="tab" aria-selected={scope === id}>{label}</button>
          ))}
        </div>

        {!query.trim() ? (
          <>
            <RecentSearches items={recent} onPick={(term) => changeQuery(term)} onClear={onClearRecent} />
            <SearchEmpty popular={popular} onPick={(term) => changeQuery(term)} />
          </>
        ) : (
          <>
            {suggestions.length > 0 && (
              <div className="suggestion-list">
                <span className="eyebrow">Suggestions</span>
                {suggestions.map((suggestion, index) => {
                  const label = typeof suggestion === 'string' ? suggestion : suggestion.title;
                  return (
                    <button key={`${label}-${index}`} onClick={() => changeQuery(label)}>
                      <Search size={15} /><span>{label}</span><ChevronRight size={14} />
                    </button>
                  );
                })}
              </div>
            )}
            {loading && page === 1 && <ListSkeleton count={4} />}
            {error && !visible.length && !loading && <ErrorState title={copy.errors.search} description={error} onRetry={() => setRetryVersion((value) => value + 1)} />}
            {!loading && !error && !visible.length && (
              <EmptyState
                icon={Search}
                eyebrow="No results found"
                title={`Nothing matched “${query.trim()}”.`}
                description="Try a different title or genre."
                actionLabel="Clear search"
                onAction={() => changeQuery('')}
              />
            )}
            {visible.length > 0 && (
              <>
                {scope === 'ALL' ? (
                  <>
                    {movies.length > 0 && <SearchResultsGroup title="Movies" items={movies} onOpen={onOpen} onPlay={onPlay} />}
                    {series.length > 0 && <SearchResultsGroup title="Series" items={series} onOpen={onOpen} onPlay={onPlay} />}
                    {other.length > 0 && <SearchResultsGroup title="Results" items={other} onOpen={onOpen} onPlay={onPlay} />}
                  </>
                ) : <SearchResultsGroup title={scope === 'MOVIES' ? 'Movies' : 'Series'} items={visible} onOpen={onOpen} onPlay={onPlay} />}
                {error && <ErrorState title="More results couldn’t load." description={error} onRetry={() => setRetryVersion((value) => value + 1)} />}
                {loading && page > 1 && <ListSkeleton count={2} />}
                {canLoadMore && !loading && (
                  <button className="button button-outline search-load-more" onClick={() => setPage((value) => value + 1)}>Load more results <ChevronRight size={15} /></button>
                )}
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function SearchResultsGroup({ title, items, onOpen, onPlay }) {
  return (
    <section className="search-results-group">
      <div className="rail-heading">
        <div><h2>{title}</h2></div>
        <span className="result-count">{items.length} {items.length === 1 ? 'result' : 'results'}</span>
      </div>
      <div className="search-result-list">
        {items.map((item) => (
          <div className="search-result-row" key={item.id}>
            <button className="search-result-main" onClick={() => onOpen(item)}>
              <span className="search-result-art">
                {item.poster ? <img src={item.poster} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}
              </span>
              <span className="search-result-copy">
                <strong>{item.title}</strong>
                <span>{metaLine(item)}</span>
              </span>
            </button>
            <button className="search-result-play" onClick={() => onPlay(item)} aria-label={`Play ${item.title}`}><Play size={16} fill="currentColor" /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function EpisodeRow({ episode, code, progress, watched, isCurrent, onPlay, isTV }) {
  return (
    <article className={`episode-row ${isCurrent ? 'is-current' : ''}`}>
      <button className="episode-thumb" data-tv-focus={isTV ? 'true' : undefined} onClick={onPlay} aria-label={`Play ${episode.title}`}>
        {episode.thumbnail ? <img src={episode.thumbnail} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}
        <span className="episode-thumb-play"><Play size={18} fill="currentColor" /></span>
        {progress > 0 && <ProgressBar value={progress} className="episode-progress" />}
      </button>
      <div className="episode-copy">
        <div className="episode-meta">
          <span>{code}</span>
          {episode.runtime && <><i />{episode.runtime}</>}
          {watched && <><i /><span className="episode-watched"><Check size={13} /> Watched</span></>}
        </div>
        <h3>{episode.title}</h3>
        {episode.description && <p>{episode.description}</p>}
      </div>
      <button className="episode-play" data-tv-focus={isTV ? 'true' : undefined} onClick={onPlay} aria-label={`Play ${episode.title}`}>
        <Play size={18} fill="currentColor" />
      </button>
    </article>
  );
}

function DetailScreen({ item, onBack, onPlay, onToggleSaved, isSaved, onDownload, onOpen, isTV, history = [], onShare, user }) {
  const [details, setDetails] = useState({ content: item, seasons: [], recommendations: [], recommendationsError: '', loading: true, error: '' });
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!item) return () => controller.abort();
    setDetails((current) => ({ ...current, content: item, loading: true, error: '' }));
    const subjectId = item.subjectId || item.providerItemId;
    const identifier = { subjectId, detailPath: item.detailPath, signal: controller.signal };
    const detailPromise = (subjectId || item.detailPath) ? catalogApi.getDetails(identifier) : Promise.reject(new Error('no-identifier'));
    const recommendationPromise = (subjectId || item.detailPath) ? catalogApi.getRecommendations(identifier) : Promise.resolve(null);
    Promise.allSettled([detailPromise, recommendationPromise]).then(([detailResult, recommendationResult]) => {
      if (controller.signal.aborted) return;
      let content = item;
      let seasonsForItem = [];
      let error = '';
      if (detailResult.status === 'fulfilled') {
        content = detailResult.value?.title || item;
        seasonsForItem = detailResult.value?.seasons || [];
      } else {
        error = friendlyError(detailResult.reason, copy.errors.details);
      }
      const recommendations = recommendationResult.status === 'fulfilled'
        ? recommendationResult.value.items.filter((entry) => entry.id !== item.id)
        : [];
      const recommendationsError = recommendationResult.status === 'rejected'
        ? friendlyError(recommendationResult.reason, copy.errors.similar)
        : '';
      setDetails({ content, seasons: seasonsForItem, recommendations, recommendationsError, loading: false, error });
      setSelectedSeasonId((current) => (current && seasonsForItem.some((season) => season.id === current) ? current : seasonsForItem[0]?.id || ''));
    });
    return () => controller.abort();
  }, [item, retryKey]);

  const content = details.content || item;
  if (!content) return null;
  const seasonIndex = Math.max(0, details.seasons.findIndex((season) => season.id === selectedSeasonId));
  const season = details.seasons[seasonIndex] || details.seasons[0];
  const episodeList = season?.episodes || [];
  const isSeries = content.type === 'series';
  const entries = history.filter((entry) => entry.content?.id === content.id);
  const latest = sortedHistory(entries)[0] || null;
  const resume = latest ? resumeTarget(latest) : null;
  const resumableEpisode = latest?.episodeId ? episodeList.find((episode) => episode.id === latest.episodeId) : undefined;
  const watchLabel = resume?.isResume ? (latest?.label ? `Resume ${latest.label}` : 'Resume') : 'Watch now';
  // The API model carries cast as records (`{ name, character, avatar }`), while
  // card titles can still carry plain strings. Normalise both to renderable rows
  // here so a provider shape change can never crash the screen.
  const castList = (content.cast || [])
    .map((person) => (typeof person === 'string' ? { name: person } : person))
    .filter((person, index, all) => person?.name && all.findIndex((other) => other?.name === person.name) === index);

  const playTitle = () => onPlay(content, {
    entry: latest,
    seasons: details.seasons,
    episode: resumableEpisode,
    episodeLabel: resumableEpisode ? episodeCode(seasonIndex, episodeList.indexOf(resumableEpisode), season, resumableEpisode) : undefined,
    nextUp: resumableEpisode ? nextEpisode(details.seasons, { seasonId: season?.id, episodeId: resumableEpisode.id }) : null,
    startPosition: resume?.isResume ? resume.position : 0,
  });

  return (
    <main className={`detail-screen ${isTV ? 'tv-detail-screen' : ''}`}>
      {details.loading && !content.backdrop ? <DetailSkeleton /> : (
        <section className="detail-hero">
          {content.backdrop && <img className="detail-art" src={content.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}
          <div className="detail-art-wash" />
          <div className="detail-topline">
            <BackButton onClick={onBack} />
            <div className="detail-top-actions">
              <button className="round-button" onClick={() => onShare(content)} aria-label="Share title"><Share2 size={17} /></button>
              <button className="round-button" onClick={() => document.getElementById('about-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' })} aria-label="About this title"><CircleHelp size={17} /></button>
            </div>
          </div>
          <div className="detail-hero-layout">
            <div className="detail-copy">
              <span className="detail-badge"><VeyraMark size={14} /> {content.type === 'series' ? 'Series' : content.type === 'movie' ? 'Film' : 'Title'}</span>
              <h1>{content.title}</h1>
              <div className="detail-meta">
                {content.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {content.rating}</span>}
                {content.year && <span>{content.year}</span>}
                {content.runtime && <span>{content.runtime}</span>}
                {isSeries && details.seasons.length > 0 && <span>{details.seasons.length} {details.seasons.length === 1 ? 'season' : 'seasons'}</span>}
                {content.maturity && <span className="meta-maturity">{content.maturity}</span>}
              </div>
              {content.genres?.length > 0 && <div className="detail-genres">{content.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>}
              <p className="detail-description">{content.synopsis || (details.loading ? 'Loading…' : 'A synopsis for this title is not available yet.')}</p>
              <div className="detail-actions">
                <button className="button button-primary" data-tv-focus={isTV ? 'true' : undefined} onClick={playTitle}>
                  <Play size={16} fill="currentColor" /> {watchLabel}
                </button>
                <button
                  className={`button button-glass ${isSaved(content.id) ? 'is-saved' : ''}`}
                  data-tv-focus={isTV ? 'true' : undefined}
                  onClick={() => onToggleSaved(content)}
                >
                  {isSaved(content.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved(content.id) ? 'In My List' : 'My List'}
                </button>
                <button className="round-button detail-download" data-tv-focus={isTV ? 'true' : undefined} aria-label="Download title" onClick={() => onDownload(content)}>
                  <Download size={17} />
                </button>
              </div>
              {isSeries && season?.label && (
                <div className="detail-continue-note">
                  <span className="live-dot" /> {season.label} <span>·</span> {episodeList.length} {episodeList.length === 1 ? 'episode' : 'episodes'}
                </div>
              )}
            </div>
            {content.poster && (
              <div className="detail-poster">
                <img src={content.poster} alt={`${content.title} artwork`} onError={(event) => event.currentTarget.remove()} />
                <span><VeyraMark size={13} /> VEYRA</span>
              </div>
            )}
          </div>
        </section>
      )}

      <div className="detail-body page-container">
        {details.error && !details.loading && <ErrorState title={copy.errors.details} description={details.error} onRetry={() => setRetryKey((value) => value + 1)} />}
        <section id="about-title" className="about-block">
          <span className="eyebrow">About</span>
          <h2>{content.title}</h2>
          <p>{content.synopsis || 'A description for this title is not available yet.'}</p>
          <div className="credits">
            {content.director && <span><small>Directed by</small>{content.director}</span>}
            {content.genres?.length > 0 && <span><small>Genre</small>{content.genres.join(' · ')}</span>}
            {content.maturity && <span><small>Rating</small>{content.maturity}</span>}
          </div>
        </section>

        {isSeries && (
          <section className="episodes-section">
            <div className="rail-heading episode-heading">
              <div><span className="eyebrow">Episodes</span><h2>{season?.label || 'Season'}</h2></div>
              {details.seasons.length > 1 && (
                <label className="season-select">
                  <span className="sr-only">Select season</span>
                  <select data-tv-focus={isTV ? 'true' : undefined} value={season?.id || ''} onChange={(event) => setSelectedSeasonId(event.target.value)}>
                    {details.seasons.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                  </select>
                  <ChevronDown size={16} />
                </label>
              )}
            </div>
            {details.loading ? <EpisodeSkeleton count={3} /> : episodeList.length ? (
              <div className="episode-list">
                {episodeList.map((episode, index) => {
                  const code = episodeCode(seasonIndex, index, season, episode);
                  const entry = history.find((row) => row.content?.id === content.id && row.episodeId === episode.id);
                  const target = entry ? resumeTarget(entry) : { position: 0, isResume: false };
                  return (
                    <EpisodeRow
                      key={episode.id}
                      episode={episode}
                      code={code}
                      progress={entry ? progressPercent(entry.position, entry.duration) : 0}
                      watched={Boolean(entry?.completed)}
                      isCurrent={Boolean(entry) && !entry?.completed && target.isResume}
                      isTV={isTV}
                      onPlay={() => onPlay(content, {
                        entry,
                        seasons: details.seasons,
                        episode,
                        episodeLabel: code,
                        nextUp: nextEpisode(details.seasons, { seasonId: season?.id, episodeId: episode.id }),
                        startPosition: target.isResume ? target.position : 0,
                      })}
                    />
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={Film} eyebrow="Episodes" title="Episodes aren’t available yet." description="They will appear here as soon as this series is ready." quiet />
            )}
          </section>
        )}

        {castList.length > 0 && (
          <section className="cast-section">
            <div className="rail-heading"><div><span className="eyebrow">Cast</span><h2>Who you’ll see</h2></div>{content.director && <span className="cast-note">Directed by {content.director}</span>}</div>
            <div className="cast-list">
              {castList.map((person, index) => (
                <div className="cast-person" key={`${person.name}-${index}`}>
                  <span className={`cast-avatar cast-avatar-${index % 4}`}><span>{person.name.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span></span>
                  <span>{person.name}{person.character && <small>{person.character}</small>}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        {details.recommendationsError && <ErrorState title={copy.errors.similar} description={details.recommendationsError} onRetry={() => setRetryKey((value) => value + 1)} />}
        {details.recommendations.length > 0 && (
          <ContentRail title="More like this" eyebrow="Keep the feeling going" items={details.recommendations} onItemClick={onOpen} />
        )}
      </div>
    </main>
  );
}

function MyListScreen({ onGo, onOpen, onPlay, savedItems, onRemove, user }) {
  const [tab, setTab] = useState('all');
  const visible = savedItems.filter((item) => tab === 'all' || item.type === tab);
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container library-page">
        <PageTitle title="My List" description="Everything you saved, on this device." right={<span className="library-count">{visible.length} saved</span>} />
        <div className="library-tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')}>Everything <span>{savedItems.length}</span></button>
          <button role="tab" aria-selected={tab === 'movie'} className={tab === 'movie' ? 'selected' : ''} onClick={() => setTab('movie')}>Movies <span>{savedItems.filter((item) => item.type === 'movie').length}</span></button>
          <button role="tab" aria-selected={tab === 'series'} className={tab === 'series' ? 'selected' : ''} onClick={() => setTab('series')}>Series <span>{savedItems.filter((item) => item.type === 'series').length}</span></button>
        </div>
        {visible.length ? (
          <div className="poster-grid library-grid">
            {visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} onPlay={onPlay} onRemove={onRemove} />)}
          </div>
        ) : (
          <EmptyState
            icon={Heart}
            eyebrow="Your list"
            title={copy.empties.list.title}
            description={copy.empties.list.body}
            actionLabel={copy.actions.explore}
            onAction={() => onGo('discover')}
          />
        )}
      </div>
    </main>
  );
}

function ContinueScreen({ onGo, onOpen, onPlay, items = [], user }) {
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container continue-page">
        <PageTitle title="Continue watching" description="Pick up exactly where you left off." />
        {items.length ? (
          <div className="continue-list">
            {items.map(({ content, entry, percent, remainingLabel, label }) => (
              <article className="continue-card" key={entry.id}>
                <button className="continue-art" onClick={() => onPlay(content, { entry, startPosition: entry.position })} aria-label={`Resume ${content.title}`}>
                  {content.poster && <img src={content.poster} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} />}
                  <span><Play size={18} fill="currentColor" /></span>
                  <ProgressBar value={percent} />
                </button>
                <div className="continue-info">
                  <span className="eyebrow">{label || (content.type === 'series' ? 'Series' : 'Film')}</span>
                  <h2>{content.title}</h2>
                  <p>{remainingLabel} <span>·</span> {percent}% watched</p>
                  <div className="continue-actions">
                    <button className="button button-primary" onClick={() => onPlay(content, { entry, startPosition: entry.position })}><Play size={16} fill="currentColor" /> Resume</button>
                    <button className="text-button" onClick={() => onOpen(content)}>Details <ChevronRight size={15} /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Clock3}
            eyebrow="Continue watching"
            title={copy.empties.continue.title}
            description={copy.empties.continue.body}
            actionLabel={copy.actions.explore}
            onAction={() => onGo('discover')}
          />
        )}
      </div>
    </main>
  );
}

function HistoryScreen({ onGo, onOpen, onPlay, entries = [], onClear, onRemove, user }) {
  const [askClear, setAskClear] = useState(false);
  const rows = sortedHistory(entries);
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container history-page">
        <PageTitle
          title="Watch history"
          description="Everything you watched, newest first."
          right={rows.length > 0 && <button className="subtle-action" onClick={() => setAskClear(true)}><Trash2 size={15} /> Clear</button>}
        />
        {rows.length ? (
          <div className="history-list">
            {rows.map((entry) => {
              const item = entry.content;
              if (!item) return null;
              const percent = progressPercent(entry.position, entry.duration);
              return (
                <article className="history-row" key={entry.id}>
                  <button className="history-art" onClick={() => onOpen(item)} aria-label={`Open ${item.title}`}>
                    {item.poster ? <img src={item.poster} alt="" loading="lazy" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}
                    {percent > 0 && <ProgressBar value={percent} />}
                  </button>
                  <div className="history-info">
                    <span className="eyebrow">{relativeDay(entry.updatedAt)}</span>
                    <h2>{item.title}</h2>
                    <span>{entry.label || (item.type === 'series' ? 'Series' : 'Film')} <i>·</i> {entry.completed ? 'Finished' : `${percent}% watched`}</span>
                  </div>
                  <div className="history-actions">
                    <button className="history-resume" onClick={() => onPlay(item, { entry, startPosition: entry.completed ? 0 : entry.position })} aria-label={`Resume ${item.title}`}><Play size={16} fill="currentColor" /></button>
                    <button className="history-remove" aria-label={`Remove ${item.title} from history`} onClick={() => onRemove(entry)}><X size={16} /></button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={History}
            eyebrow="Your history"
            title={copy.empties.history.title}
            description={copy.empties.history.body}
            actionLabel={copy.actions.explore}
            onAction={() => onGo('discover')}
          />
        )}
      </div>
      {askClear && (
        <Dialog
          title="Clear your watch history?"
          description="This removes what you have watched on this device. Your list is untouched."
          confirmLabel="Clear history"
          onConfirm={() => { onClear(); setAskClear(false); }}
        />
      )}
    </main>
  );
}

const DOWNLOAD_LABELS = {
  [DOWNLOAD_STATES.queued]: 'Queued',
  [DOWNLOAD_STATES.downloading]: 'Downloading',
  [DOWNLOAD_STATES.paused]: 'Paused',
  [DOWNLOAD_STATES.completed]: 'Downloaded',
  [DOWNLOAD_STATES.failed]: 'Failed',
  [DOWNLOAD_STATES.removing]: 'Removing…',
};

function DownloadsScreen({ onGo, storage, user, downloads = [], capability, onPause, onResume, onRetry, onRemove }) {
  const ordered = [...downloads].sort((a, b) => {
    const rank = (state) => (state === DOWNLOAD_STATES.downloading ? 0 : state === DOWNLOAD_STATES.queued ? 1 : state === DOWNLOAD_STATES.paused ? 2 : state === DOWNLOAD_STATES.removing ? 3 : state === DOWNLOAD_STATES.failed ? 4 : 5);
    return rank(a.state) - rank(b.state);
  });

  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container downloads-page">
        <PageTitle title="Downloads" description="Keep titles on your device for when you are offline." />
        {!ordered.length && (
          <EmptyState
            icon={Download}
            eyebrow="Offline viewing"
            title={copy.empties.downloads.title}
            description={capability?.supported
              ? 'Save something for offline viewing from any title page.'
              : 'This device cannot save downloads yet.'}
            actionLabel={copy.actions.explore}
            onAction={() => onGo('discover')}
          />
        )}
        {ordered.length > 0 && (
          <ul className="download-list">
            {ordered.map((entry) => {
              const percent = downloadProgress(entry);
              const size = formatBytes(entry.sizeBytes);
              const context = [
                entry.seasonNumber && entry.episodeNumber ? episodeCode(entry.seasonNumber - 1, entry.episodeNumber - 1) : '',
                entry.height ? `${entry.height}p` : '',
                size,
              ].filter(Boolean).join(' · ');
              return (
                <li key={entry.id} className={`download-row is-${entry.state}`}>
                  <span className="download-art" aria-hidden="true">
                    {entry.content?.poster
                      ? <img src={entry.content.poster} alt="" loading="lazy" decoding="async" />
                      : <Download size={18} />}
                  </span>
                  <div className="download-body">
                    <strong>{entry.content?.title || entry.label}</strong>
                    {context && <small className="download-context">{context}</small>}
                    {entry.state === DOWNLOAD_STATES.downloading && (
                      <span className="download-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${entry.content?.title || 'Title'} download progress`}>
                        <i style={{ width: `${percent}%` }} />
                      </span>
                    )}
                    <small className="download-state">
                      {DOWNLOAD_LABELS[entry.state] || entry.state}
                      {entry.state === DOWNLOAD_STATES.downloading && percent ? ` · ${percent}%` : ''}
                      {entry.state === DOWNLOAD_STATES.failed && entry.error ? ` · ${entry.error}` : ''}
                    </small>
                  </div>
                  <div className="download-actions">
                    {entry.state === DOWNLOAD_STATES.downloading && (
                      <button className="download-action" onClick={() => onPause?.(entry.id)}>Pause</button>
                    )}
                    {entry.state === DOWNLOAD_STATES.paused && (
                      <button className="download-action" onClick={() => onResume?.(entry.id)}>Resume</button>
                    )}
                    {entry.state === DOWNLOAD_STATES.failed && (
                      <button className="download-action" onClick={() => onRetry?.(entry.id)}>Retry</button>
                    )}
                    {entry.state !== DOWNLOAD_STATES.removing && (
                      <button className="download-action is-danger" onClick={() => onRemove?.(entry.id)} aria-label={`Remove ${entry.content?.title || 'download'}`}>Remove</button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {!capability?.supported && (
          <p className="storage-note">Saving files is not available in this environment yet, so downloads stay disabled.</p>
        )}
        {storage && <p className="storage-note"><HardDrive size={15} /> {storage.used} used · {storage.free} available</p>}
      </div>
    </main>
  );
}

function ProfileScreen({ onGo, user, isOffline, onSignIn }) {
  const libraryLinks = [
    { title: 'Continue watching', detail: 'Jump back in', icon: Play, route: 'continue' },
    { title: 'Watch history', detail: 'Everything you watched', icon: History, route: 'history' },
    { title: 'My List', detail: 'Saved titles', icon: Heart, route: 'list' },
    { title: 'Downloads', detail: 'Offline viewing', icon: Download, route: 'downloads' },
  ];
  const appLinks = [
    { title: 'Preferences', detail: 'Playback and appearance', icon: Settings, route: 'settings' },
    { title: 'Devices', detail: 'Where you watch', icon: MonitorPlay, route: 'devices' },
    { title: 'Notifications', detail: 'New titles and episodes', icon: Bell, route: 'notifications' },
    { title: 'About VEYRA', detail: 'Version 1.0.0', icon: CircleHelp, route: 'settings' },
  ];
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container profile-page">
        <PageTitle title="Me" description="Your library, your settings." />
        <section className="profile-card">
          <div className="profile-avatar"><Avatar name={user?.name || 'Guest'} size="large" /><span /></div>
          <div className="profile-identity">
            <span className="eyebrow">Local profile</span>
            <h2>{user?.name || 'Guest'}</h2>
            <p>{user?.email || 'Your library stays on this device.'}</p>
          </div>
          <button className="profile-edit" onClick={onSignIn}>Sign in <ChevronRight size={15} /></button>
        </section>
        <div className="profile-columns">
          <section>
            <h3 className="section-label">Library</h3>
            <div className="profile-link-list">
              {libraryLinks.map(({ title, detail, icon: Icon, route }) => (
                <button className="profile-link-row" key={title} onClick={() => onGo(route)}>
                  <span className="profile-link-icon"><Icon size={17} /></span>
                  <span><strong>{title}</strong><small>{detail}</small></span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </section>
          <section>
            <h3 className="section-label">App</h3>
            <div className="profile-link-list">
              {appLinks.map(({ title, detail, icon: Icon, route }) => (
                <button className="profile-link-row" key={title} onClick={() => onGo(route)}>
                  <span className="profile-link-icon"><Icon size={17} /></span>
                  <span><strong>{title}</strong><small>{detail}</small></span>
                  <ChevronRight size={16} />
                </button>
              ))}
            </div>
          </section>
        </div>
        <div className="profile-quick-actions">
          <button onClick={() => onGo('tv-home')}>
            <Tv size={17} /><span><strong>Open TV experience</strong><small>Browse VEYRA on the big screen</small></span><ChevronRight size={16} />
          </button>
          <div className="profile-link-row">
            <span className="profile-link-icon">{isOffline ? <WifiOff size={17} /> : <Wifi size={17} />}</span>
            <span><strong>{isOffline ? 'Offline' : 'Online'}</strong><small>{isOffline ? 'Some features may be unavailable' : 'Connected'}</small></span>
          </div>
        </div>
      </div>
    </main>
  );
}

function SettingToggle({ title, detail, icon: Icon, checked, onChange }) {
  return (
    <div className="settings-row">
      <span className="setting-symbol"><Icon size={17} /></span>
      <span className="setting-copy"><strong>{title}</strong><small>{detail}</small></span>
      <button className={`switch ${checked ? 'is-on' : ''}`} role="switch" aria-checked={checked} aria-label={title} onClick={() => onChange(!checked)}><span /></button>
    </div>
  );
}

function SettingsScreen({ onGo, settings, setSettings, onClearHistory, historyCount, user }) {
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container settings-page">
        <button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Me</button>
        <PageTitle title="Settings" description="Playback, appearance and your library." />

        <section className="settings-group">
          <h3 className="section-label">Playback</h3>
          <SettingToggle title="Autoplay next episode" detail="Start the next episode automatically" icon={Play} checked={settings.autoplayNext} onChange={(value) => update('autoplayNext', value)} />
          <SettingToggle title="Subtitles" detail="Show captions when available" icon={Languages} checked={settings.subtitles} onChange={(value) => update('subtitles', value)} />
          <SettingToggle title="Data saver" detail="Prefer smaller video quality" icon={Layers} checked={settings.dataSaver} onChange={(value) => update('dataSaver', value)} />
          <div className="settings-row">
            <span className="setting-symbol"><Sparkles size={17} /></span>
            <span className="setting-copy"><strong>Video quality</strong><small>Preferred quality for playback</small></span>
            <label className="setting-select">
              <select aria-label="Video quality" value={settings.preferredQuality} onChange={(event) => update('preferredQuality', event.target.value)}>
                {['Auto', '1080p', '720p', '480p'].map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
        </section>

        <section className="settings-group">
          <h3 className="section-label">Appearance</h3>
          <div className="settings-row">
            <span className="setting-symbol"><Moon size={17} /></span>
            <span className="setting-copy"><strong>Theme</strong><small>Dark keeps the cinema feeling</small></span>
            <label className="setting-select">
              <select aria-label="Theme" value={settings.appearance} onChange={(event) => update('appearance', event.target.value)}>
                {['Dark', 'System'].map((option) => <option key={option}>{option}</option>)}
              </select>
              <ChevronDown size={14} />
            </label>
          </div>
        </section>

        <section className="settings-group">
          <h3 className="section-label">Library</h3>
          <button className="settings-link-row" onClick={onClearHistory} disabled={!historyCount}>
            <span className="setting-symbol"><Trash2 size={17} /></span>
            <span className="setting-copy"><strong>Clear watch history</strong><small>{historyCount ? `${historyCount} ${historyCount === 1 ? 'title' : 'titles'} watched` : 'Nothing watched yet'}</small></span>
            <ChevronRight size={17} />
          </button>
          <button className="settings-link-row" onClick={() => onGo('downloads')}>
            <span className="setting-symbol"><HardDrive size={17} /></span>
            <span className="setting-copy"><strong>Downloads and storage</strong><small>Offline viewing and space used</small></span>
            <ChevronRight size={17} />
          </button>
        </section>
      </div>
    </main>
  );
}

function DevicesScreen({ onGo, user }) {
  const current = deviceName();
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container devices-page">
        <button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Me</button>
        <PageTitle title="Devices" description="Where you watch VEYRA." />
        <div className="device-list">
          <article className="device-row is-current">
            <span className="device-icon"><MonitorPlay size={18} /></span>
            <div><strong>{current}</strong><small>This device</small></div>
            <span className="device-badge">Active</span>
          </article>
          <article className="device-row is-empty">
            <span className="device-icon"><UserRound size={18} /></span>
            <div><strong>No other devices</strong><small>Sign in to watch on your other screens.</small></div>
          </article>
        </div>
      </div>
    </main>
  );
}

function NotificationsScreen({ onGo, user }) {
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} user={user} />
      <div className="page-container notifications-page">
        <PageTitle title="Notifications" description="New titles, new episodes, nothing else." />
        <EmptyState
          icon={Bell}
          eyebrow="Nothing new yet"
          title="No notifications yet."
          description="We’ll let you know when something worth watching arrives."
          actionLabel={copy.actions.explore}
          onAction={() => onGo('discover')}
        />
      </div>
    </main>
  );
}

function OfflineBanner({ onRetry, onDismiss, retrying }) {
  return (
    <div className="offline-banner" role="status">
      <WifiOff size={16} />
      <span><strong>{copy.offline.title}</strong> {copy.offline.body}</span>
      <button onClick={onRetry} disabled={retrying}><Wifi size={14} /> {retrying ? 'Checking…' : 'Retry'}</button>
      <button className="offline-banner-close" onClick={onDismiss} aria-label="Dismiss offline notice"><X size={14} /></button>
    </div>
  );
}

function TVHomeScreen({ onGo, onOpen, onPlay, onSearch, onProfile, onToggleSaved, isSaved, featured = [], sections = [], loading, error, onRetry, user, playerLabel }) {
  const hasContent = featured.length > 0 || sections.length > 0;
  return (
    <main className="tv-home-screen">
      <aside className="tv-sidebar">
        <Brand onClick={() => onGo('tv-home')} data-tv-focus="true" />
        <nav>
          <button className="tv-nav-active" data-tv-focus="true" onClick={() => onGo('tv-home')}><span><Play size={18} /></span>Home</button>
          <button data-tv-focus="true" onClick={onSearch}><span><Search size={18} /></span>Search</button>
          <button data-tv-focus="true" onClick={() => onGo('list')}><span><Heart size={18} /></span>My List</button>
          <button data-tv-focus="true" onClick={onProfile}><span><UserRound size={18} /></span>Profile</button>
        </nav>
        <div className="tv-sidebar-bottom">
          <Avatar name={user?.name || 'Guest'} />
          <span>{user?.name || 'Guest'}</span>
          <button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ChevronRight size={14} /></button>
        </div>
      </aside>
      <div className="tv-main">
        <div className="tv-topline">
          <span className="tv-now"><span /> {loading ? 'Loading your cinema' : error ? 'Some rows are missing' : 'Tonight’s picks'}</span>
          <div><span className="tv-clock">VEYRA</span><button data-tv-focus="true" onClick={onProfile} aria-label="Open profile"><UserRound size={17} /></button></div>
        </div>
        {loading && !hasContent ? <HeroSkeleton /> : featured.length > 0 ? (
          <HeroCarousel
            items={featured}
            isSaved={isSaved}
            onToggleSaved={onToggleSaved}
            onOpen={onOpen}
            onPlay={onPlay}
            primaryLabel={playerLabel}
            isTV
          />
        ) : (
          <section className="tv-feature hero-quiet">
            <div className="tv-feature-wash" />
            <div className="tv-feature-copy">
              <span className="eyebrow"><VeyraMark size={14} /> VEYRA</span>
              <h1>Your next<br /><em>story.</em></h1>
              <p>{error || 'Your cinema is ready for its first title.'}</p>
              <div className="tv-feature-actions">
                <button className="button button-primary" data-tv-focus="true" onClick={onSearch}><Search size={16} /> Find something to watch</button>
                {error && <button className="button button-glass" data-tv-focus="true" onClick={onRetry}>{copy.actions.retry}</button>}
              </div>
            </div>
          </section>
        )}
        <section className="tv-rails">
          {loading && !sections.length ? <RailSkeleton count={4} /> : sections.map((section) => (
            <ContentRail key={section.id} title={section.title} items={section.items} onItemClick={onOpen} onPlayItem={onPlay} tvFocus />
          ))}
        </section>
      </div>
      <div className="tv-remote-hint"><span>↑ ↓ ← → move</span><span>OK select</span><span>BACK return</span></div>
    </main>
  );
}

function TVProfile({ onGo, user }) {
  return (
    <div className="tv-profile-popover">
      <Avatar name={user?.name || 'Guest'} />
      <strong>{user?.name || 'Guest'}</strong>
      <small>Your library stays on this device.</small>
      <button data-tv-focus="true" onClick={() => onGo('profile')}>Profile <ChevronRight size={14} /></button>
      <button data-tv-focus="true" onClick={() => onGo('settings')}>Settings <ChevronRight size={14} /></button>
      <button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ChevronRight size={14} /></button>
    </div>
  );
}

export default function App() {
  const [nav, setNav] = useState(() => ({
    current: typeof window !== 'undefined' && safeRead(STORAGE_KEYS.welcome, false) ? initialRoute() : 'welcome',
    params: {},
    stack: [],
  }));
  const [library, setLibrary] = useState(() => (typeof window === 'undefined' ? { history: [], recent: [], seenWelcome: false } : loadLibrary(window.localStorage)));
  const [savedItems, setSavedItems] = useState(storedList);
  const [settings, setSettings] = useState(() => (typeof window === 'undefined' ? DEFAULT_SETTINGS : loadSettings(window.localStorage, DEFAULT_SETTINGS)));
  const [homeData, setHomeData] = useState({ loading: true, error: '', featured: [], sections: [], catalog: [] });
  const [selectedType, setSelectedType] = useState('all');
  const [toast, setToast] = useState('');
  const [dialog, setDialog] = useState(null);
  const [isOffline, setIsOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false));
  const [offlineDismissed, setOfflineDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [storage, setStorage] = useState(null);
  const [showSplash, setShowSplash] = useState(true);
  const [tvProfileOpen, setTvProfileOpen] = useState(false);
  const toastTimer = useRef(null);
  const navRef = useRef(nav);
  navRef.current = nav;

  const user = useMemo(() => ({ name: 'Guest', email: '' }), []);

  const notify = useCallback((message) => {
    if (!message) return;
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  }, []);

  const loadHome = useCallback(async (signal) => {
    setHomeData((current) => ({ ...current, loading: true, error: '' }));
    const results = await Promise.allSettled([
      catalogApi.getHome({ signal }),
      catalogApi.getTrending({ page: 0, perPage: 18, signal }),
      catalogApi.getHot({ signal }),
    ]);
    if (signal?.aborted) return;

    const sections = [];
    const addSection = (title, items) => {
      const normalized = uniqueById(items || []);
      if (!normalized.length) return;
      if (sections.some((section) => section.title.toLowerCase() === title.toLowerCase())) return;
      sections.push({ id: `rail:${title}`, title, items: normalized });
    };

    const [home, trending, hot] = results;
    let heroItems = [];
    if (home.status === 'fulfilled') {
      heroItems = home.value.hero;
      home.value.rails.forEach((section) => addSection(section.title, section.items));
    }
    if (trending.status === 'fulfilled') addSection('Trending now', trending.value.items);
    if (hot.status === 'fulfilled') {
      (hot.value.rails || []).forEach((section) => addSection(section.title, section.items));
    }

    const catalog = uniqueById(sections.flatMap((section) => section.items));
    const failures = results.filter((result) => result.status === 'rejected');
    let error = '';
    if (!heroItems.length && !catalog.length) {
      error = failures.length ? friendlyError(failures[0].reason, copy.errors.home) : 'Nothing is available to show right now.';
    } else if (failures.length) {
      error = 'Some rows could not be loaded.';
    }
    const featured = (heroItems.length ? heroItems : catalog).slice(0, 5);
    setHomeData({ loading: false, error, featured, sections, catalog });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    loadHome(controller.signal);
    return () => controller.abort();
  }, [loadHome]);

  useEffect(() => {
    if (nav.current === 'welcome') return undefined;
    const timer = window.setTimeout(() => setShowSplash(false), 650);
    return () => window.clearTimeout(timer);
  }, [nav.current]);

  useEffect(() => { writeJson(window.localStorage, STORAGE_KEYS.history, library.history); }, [library.history]);
  useEffect(() => { writeJson(window.localStorage, STORAGE_KEYS.searches, library.recent); }, [library.recent]);
  useEffect(() => { writeJson(window.localStorage, STORAGE_KEYS.list, savedItems); }, [savedItems]);
  useEffect(() => { saveSettings(window.localStorage, settings); }, [settings]);
  useEffect(() => {
    const seen = nav.current !== 'welcome' || library.seenWelcome;
    if (seen) writeJson(window.localStorage, STORAGE_KEYS.welcome, true);
  }, [nav.current, library.seenWelcome]);

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-color-scheme: light)');
    const apply = () => {
      const light = settings.appearance === 'System' && Boolean(media?.matches);
      document.documentElement.dataset.appearance = light ? 'light' : 'dark';
    };
    apply();
    media?.addEventListener?.('change', apply);
    return () => media?.removeEventListener?.('change', apply);
  }, [settings.appearance]);

  // Connectivity is a state, not a different universe: the screen stays put.
  useEffect(() => {
    const onOffline = () => { setIsOffline(true); setOfflineDismissed(false); };
    const onOnline = () => setIsOffline(false);
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('offline', onOffline); window.removeEventListener('online', onOnline); };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!navigator.storage?.estimate) return undefined;
    navigator.storage.estimate().then(({ usage = 0, quota = 0 }) => {
      if (cancelled || !quota) return;
      const gb = (value) => `${(value / 1024 ** 3).toFixed(1)} GB`;
      setStorage({ used: gb(usage), free: gb(Math.max(0, quota - usage)) });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const go = useCallback((destination, params = {}) => {
    setNav((current) => ({
      current: destination,
      params,
      stack: [...current.stack, { current: current.current, params: current.params }],
    }));
    setTvProfileOpen(false);
    window.history.pushState({ veyra: true }, '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const back = useCallback(() => {
    setNav((current) => {
      if (!current.stack.length) return current;
      const previous = current.stack[current.stack.length - 1];
      return { current: previous.current, params: previous.params, stack: current.stack.slice(0, -1) };
    });
    setTvProfileOpen(false);
  }, []);

  useEffect(() => {
    const onPop = () => {
      setNav((current) => {
        if (!current.stack.length) return current;
        const previous = current.stack[current.stack.length - 1];
        return { current: previous.current, params: previous.params, stack: current.stack.slice(0, -1) };
      });
      setTvProfileOpen(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const recordProgress = useCallback(({ item, episode, label, position, duration, completed }) => {
    if (!item) return;
    const id = historyId(item, episode);
    if (!id) return;
    setLibrary((current) => ({
      ...current,
      history: upsertHistory(current.history, {
        id,
        content: contentReference(item),
        episodeId: episode?.id,
        label,
        // Stored 1-based so it matches the playback API when a title is resumed.
        seasonNumber: episode?.seasonNumber ?? episode?.apiSeason,
        episodeNumber: episode?.episodeNumber ?? episode?.apiEpisode,
        position,
        duration,
        percent: progressPercent(position, duration),
        completed,
      }),
    }));
  }, []);

  const rememberSearch = useCallback((term) => {
    setLibrary((current) => ({ ...current, recent: withSearchTerm(term, current.recent) }));
  }, []);

  const clearHistory = useCallback(() => {
    setLibrary((current) => ({ ...current, history: [] }));
    notify('Watch history cleared');
  }, [notify]);

  const toggleSaved = useCallback((item) => {
    if (!item?.id) return;
    setSavedItems((current) => {
      const alreadySaved = current.some((entry) => entry.id === item.id);
      notify(alreadySaved ? `${item.title} removed from My List` : `${item.title} added to My List`);
      return alreadySaved ? current.filter((entry) => entry.id !== item.id) : [contentReference(item), ...current];
    });
  }, [notify]);

  const isSaved = useCallback((id) => savedItems.some((item) => item.id === id), [savedItems]);

  const shareTitle = useCallback(async (item) => {
    const text = `${item.title}${item.year ? ` (${item.year})` : ''} on VEYRA`;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, text });
        return;
      }
      await navigator.clipboard?.writeText(text);
      notify('Link copied');
    } catch {
      notify('Sharing isn’t available right now');
    }
  }, [notify]);

  const play = useCallback((item, options = {}) => {
    if (!item) return;
    if (isOffline) {
      notify('You’re offline. Playback needs a connection.');
      return;
    }
    const entry = options.entry || null;
    const resume = entry ? resumeTarget(entry) : { position: 0, isResume: false };
    go('player', {
      item,
      episode: options.episode || null,
      episodeLabel: options.episodeLabel || entry?.label || '',
      seasons: options.seasons || [],
      nextUp: options.nextUp || null,
      startPosition: options.startPosition ?? resume.position,
    });
  }, [go, isOffline, notify]);

  const openTitle = useCallback((item) => {
    if (!item) return;
    go('detail', { item });
  }, [go]);

  const [downloads, setDownloads] = useState([]);
  const downloadManager = useRef(null);
  const downloadSupport = useMemo(() => downloadCapability(), []);

  useEffect(() => {
    const manager = new DownloadManager({
      storage: window.localStorage,
      resolveUrl: ({ item, episode, quality }) => resolveDownload({ item, episode, quality }),
      onChange: setDownloads,
    });
    downloadManager.current = manager;
    setDownloads(manager.list());
    return () => { downloadManager.current = null; };
  }, []);

  // Downloads are a real queue: the manager resolves an authorized URL through
  // the VEYRA API and reports measured progress. Where a platform cannot save
  // a file, the action says so instead of pretending.
  const startDownload = useCallback(async (item, options = {}) => {
    const manager = downloadManager.current;
    if (!item || !manager) return;
    if (!downloadSupport.supported) {
      notify(downloadSupport.reason === UNAVAILABLE_REASONS.tooLarge
        ? 'This title is too large to save on this device.'
        : 'Downloads aren’t supported on this device yet.');
      return;
    }
    const episode = options.episode || null;
    notify(`Preparing ${item.title}…`);
    const record = await manager.queue({
      item,
      episode,
      quality: settings.preferredQuality,
      content: contentReference(item),
    });
    if (!record) return;
    if (record.state === DOWNLOAD_STATES.failed) {
      notify(record.error || 'That download could not be started.');
      return;
    }
    notify(`${item.title} added to downloads`);
  }, [downloadSupport, notify, settings.preferredQuality]);

  const downloadTitle = useCallback((item) => { startDownload(item); }, [startDownload]);

  const historyEntries = sortedHistory(library.history);
  const continueItems = useMemo(() => continueWatching(library.history).map((entry) => ({
    ...entry.content,
    progress: progressPercent(entry.position, entry.duration),
  })), [library.history]);
  const continueCards = useMemo(() => continueWatching(library.history).map((entry) => ({
    content: entry.content,
    entry,
    percent: progressPercent(entry.position, entry.duration),
    remainingLabel: formatRemaining(entry.position, entry.duration) || 'Almost done',
    label: entry.label,
  })), [library.history]);

  const playerLabel = useCallback((item) => {
    const entry = sortedHistory(library.history.filter((row) => row.content?.id === item?.id))[0];
    if (!entry) return 'Watch now';
    return resumeTarget(entry).isResume ? 'Resume' : 'Watch now';
  }, [library.history]);

  const tvMode = nav.current.startsWith('tv');
  const currentItem = nav.params.item || null;
  const playerSeasons = nav.params.seasons || [];

  useEffect(() => {
    if (!tvMode) return undefined;
    const focusTimer = window.setTimeout(() => {
      document.querySelector('[data-tv-focus="true"]')?.focus?.({ preventScroll: true });
    }, 90);
    const onKey = (event) => {
      if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        moveFocus({ direction: event.key.replace('Arrow', '').toLowerCase() });
        return;
      }
      if (event.key === 'Enter' && document.activeElement?.matches?.('[data-tv-focus="true"]')) {
        event.preventDefault();
        document.activeElement.click();
        return;
      }
      if (event.key === 'Escape' || event.key === 'Backspace') {
        event.preventDefault();
        back();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener('keydown', onKey); };
  }, [tvMode, nav.current, back]);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const homeProps = {
    onGo: go,
    onSearch: () => go('search'),
    onNotifications: () => go('notifications'),
    onProfile: () => go('profile'),
    onOpen: openTitle,
    onPlay: play,
    isSaved,
    onToggleSaved: toggleSaved,
    featured: homeData.featured,
    sections: homeData.sections,
    continueItems,
    loading: homeData.loading,
    error: homeData.error,
    onRetry: () => loadHome(),
    user,
    playerLabel,
  };

  const screens = {
    welcome: (
      <WelcomeScreen
        onStart={() => { setLibrary((current) => ({ ...current, seenWelcome: true })); setNav({ current: initialRoute(), params: {}, stack: [] }); }}
        onSignIn={() => setDialog('account')}
      />
    ),
    home: <HomeScreen {...homeProps} />,
    discover: (
      <DiscoverScreen
        onGo={go}
        onOpen={openTitle}
        onPlay={play}
        selectedType={selectedType}
        setSelectedType={setSelectedType}
        sections={homeData.sections}
        items={homeData.catalog}
        loading={homeData.loading}
        error={homeData.error}
        onRetry={() => loadHome()}
        user={user}
      />
    ),
    search: (
      <SearchScreen
        onGo={go}
        onOpen={openTitle}
        onPlay={play}
        recent={library.recent}
        onRememberSearch={rememberSearch}
        onClearRecent={() => setLibrary((current) => ({ ...current, recent: [] }))}
        user={user}
      />
    ),
    detail: currentItem ? (
      <DetailScreen
        item={currentItem}
        onBack={back}
        onPlay={play}
        onToggleSaved={toggleSaved}
        isSaved={isSaved}
        onDownload={downloadTitle}
        onOpen={openTitle}
        history={library.history}
        onShare={shareTitle}
        user={user}
      />
    ) : <ErrorState title={copy.errors.details} description="This title is no longer available." onRetry={() => back()} retryLabel={copy.actions.backHome} />,
    'tv-detail': currentItem ? (
      <DetailScreen
        item={currentItem}
        onBack={back}
        onPlay={play}
        onToggleSaved={toggleSaved}
        isSaved={isSaved}
        onDownload={downloadTitle}
        onOpen={openTitle}
        isTV
        history={library.history}
        onShare={shareTitle}
        user={user}
      />
    ) : <ErrorState title={copy.errors.details} description="This title is no longer available." onRetry={() => back()} retryLabel={copy.actions.backHome} />,
    player: currentItem ? (
      <Player
        item={currentItem}
        episode={nav.params.episode}
        episodeLabel={nav.params.episodeLabel}
        seasons={playerSeasons}
        settings={settings}
        nextUp={nav.params.nextUp}
        startPosition={nav.params.startPosition || 0}
        isTV={tvMode}
        onBack={back}
        onProgress={({ position, duration, completed }) => recordProgress({
          item: currentItem,
          episode: nav.params.episode,
          label: nav.params.episodeLabel,
          position,
          duration,
          completed,
        })}
        onSelectEpisode={(season, episode, { index } = {}) => {
          const seasonIndex = Math.max(0, playerSeasons.findIndex((entry) => entry.id === season.id));
          const episodeIndex = index ?? (season.episodes || []).findIndex((entry) => entry.id === episode.id);
          const following = nextEpisode(playerSeasons, { seasonId: season.id, episodeId: episode.id });
          go('player', {
            ...nav.params,
            episode,
            episodeLabel: episodeCode(seasonIndex, Math.max(0, episodeIndex), season, episode),
            nextUp: following,
            startPosition: 0,
          });
        }}
        onOpenDetails={back}
      />
    ) : <ErrorState title={copy.errors.playback} description="This title is no longer available." onRetry={() => back()} retryLabel={copy.actions.backHome} />,
    list: (
      <MyListScreen
        onGo={go}
        onOpen={openTitle}
        onPlay={play}
        savedItems={savedItems}
        onRemove={(item) => { setSavedItems((current) => current.filter((entry) => entry.id !== item.id)); notify(`${item.title} removed from My List`); }}
        user={user}
      />
    ),
    continue: <ContinueScreen onGo={go} onOpen={openTitle} onPlay={play} items={continueCards} user={user} />,
    history: (
      <HistoryScreen
        onGo={go}
        onOpen={openTitle}
        onPlay={play}
        entries={historyEntries}
        onClear={clearHistory}
        onRemove={(entry) => setLibrary((current) => ({ ...current, history: current.history.filter((row) => row.id !== entry.id) }))}
        user={user}
      />
    ),
    downloads: (
      <DownloadsScreen
        onGo={go}
        storage={storage}
        user={user}
        downloads={downloads}
        capability={downloadSupport}
        onPause={(id) => downloadManager.current?.pause(id)}
        onResume={(id) => downloadManager.current?.resume(id)}
        onRetry={(id) => downloadManager.current?.retry(id)}
        onRemove={(id) => downloadManager.current?.remove(id)}
      />
    ),
    profile: <ProfileScreen onGo={go} user={user} isOffline={isOffline} onSignIn={() => setDialog('account')} />,
    settings: (
      <SettingsScreen
        onGo={go}
        settings={settings}
        setSettings={setSettings}
        historyCount={library.history.length}
        onClearHistory={() => setDialog('clearHistory')}
        user={user}
      />
    ),
    devices: <DevicesScreen onGo={go} user={user} />,
    notifications: <NotificationsScreen onGo={go} user={user} />,
    'tv-home': (
      <TVHomeScreen
        onGo={go}
        onOpen={openTitle}
        onPlay={play}
        onSearch={() => go('search')}
        onProfile={() => setTvProfileOpen((value) => !value)}
        onToggleSaved={toggleSaved}
        isSaved={isSaved}
        featured={homeData.featured}
        sections={homeData.sections}
        loading={homeData.loading}
        error={homeData.error}
        onRetry={() => loadHome()}
        user={user}
        playerLabel={playerLabel}
      />
    ),
  };

  const screen = screens[nav.current] || <HomeScreen {...homeProps} />;
  const showBottomNav = BOTTOM_NAV_VIEWS.has(nav.current);
  const navActive = ['home', 'discover'].includes(nav.current) ? 'home' : nav.current;

  return (
    <div className={`app-shell ${tvMode ? 'app-tv-mode' : ''}`}>
      {screen}
      {showBottomNav && <BottomNav active={navActive} onGo={(destination) => go(destination)} />}
      {nav.current === 'tv-home' && tvProfileOpen && <TVProfile onGo={go} user={user} />}
      {isOffline && !offlineDismissed && nav.current !== 'welcome' && (
        <OfflineBanner
          retrying={retrying}
          onRetry={async () => {
            setRetrying(true);
            const online = typeof navigator === 'undefined' ? true : navigator.onLine;
            setIsOffline(!online);
            if (online) {
              await loadHome();
              notify('You’re back online');
            } else {
              notify('Still offline');
            }
            setRetrying(false);
          }}
          onDismiss={() => setOfflineDismissed(true)}
        />
      )}
      <Toast message={toast} onClose={() => setToast('')} />
      {showSplash && nav.current !== 'welcome' && (
        <div className="splash-screen"><VeyraMark size={44} /><span>VEYRA</span><small>WATCH WHAT MOVES YOU</small><i /></div>
      )}
      {dialog === 'account' && (
        <Dialog
          title="Accounts aren’t available yet"
          description="Sign in to keep your library synced across devices. Until then everything stays on this device."
          confirmLabel="Got it"
          onConfirm={() => setDialog(null)}
        />
      )}
      {dialog === 'clearHistory' && (
        <Dialog
          title="Clear your watch history?"
          description="Continue watching and history will be emptied on this device."
          confirmLabel="Clear history"
          onConfirm={() => { clearHistory(); setDialog(null); }}
        />
      )}
    </div>
  );
}
