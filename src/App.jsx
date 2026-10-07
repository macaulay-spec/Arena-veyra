import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudOff,
  Compass,
  Download,
  Film,
  HardDrive,
  Heart,
  History,
  Languages,
  Moon,
  MonitorPlay,
  MoreHorizontal,
  Play,
  Plus,
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
import { movieBoxClient } from './services/moviebox/client';
import {
  contentReference,
  extractContentList,
  extractContentSections,
  extractSuggestions,
  normalizeDetail,
  normalizeSavedReference,
} from './services/moviebox/normalize';
import './styles.css';

const DEFAULT_SETTINGS = {
  language: 'English',
  appearance: 'Dark',
};

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
  const stored = readStore('veyra-list:v2', []);
  if (!Array.isArray(stored)) return [];
  const references = stored.map(normalizeSavedReference).filter(Boolean);
  return uniqueItems(references);
}

function readSettings() {
  const stored = readStore('veyra-settings:v2', {});
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
  loading = false,
  error = '',
  onRetry,
}) {
  const hero = featured || sections.flatMap((section) => section.items || [])[0] || null;
  return (
    <main className="home-page">
      <div className="home-hero-art">{hero?.backdrop && <img src={hero.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}</div>
      <div className="home-hero-gradient" />
      <TopBar isHome active="home" onGo={onGo} onSearch={onSearch} onNotifications={onNotifications} onProfile={onProfile} />
      <section className="home-hero">
        <div className="hero-content">
          <div className="hero-kicker"><span className="original-mark"><VeyraMark size={15} /></span> {hero ? 'FROM YOUR CATALOG' : 'YOUR PRIVATE CINEMA'}</div>
          <h1>{hero ? hero.title : <>Your next<br /><em>story.</em></>}</h1>
          <p className="hero-description">{hero?.synopsis || (loading ? 'Finding the stories in your catalog.' : error || 'Connect an authorized catalog API to bring your library into VEYRA.')}</p>
          {hero && <div className="hero-meta">
            {hero.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {hero.rating}</span>}
            {hero.year && <span>{hero.year}</span>}
            {hero.runtime && <span>{hero.runtime}</span>}
            {hero.genres?.length > 0 && <span>{hero.genres.slice(0, 2).join(' · ')}</span>}
          </div>}
          <div className="hero-actions">
            {hero ? <>
              <button className="button button-primary hero-watch" onClick={() => onPlay(hero)}><Play size={16} fill="currentColor" /> Playback unavailable</button>
              <button className={`button button-glass hero-list ${isSaved(hero.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(hero)}>{isSaved(hero.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved(hero.id) ? 'In My List' : 'My List'}</button>
              <button className="hero-more" onClick={() => onOpen(hero)}>Explore title <ArrowRight size={15} /></button>
            </> : <>
              <button className="button button-primary hero-watch" onClick={onSearch}><Search size={16} /> Search catalog</button>
              {error && <button className="button button-glass" onClick={onRetry}>Try again</button>}
            </>}
          </div>
        </div>
        <div className="hero-bottom-note"><span className="hero-index">VEYRA</span><span className="hero-rule" /><span>{hero ? 'CATALOG PREVIEW' : 'A QUIETER KIND OF STREAMING'}</span></div>
        <div className="hero-pagination" aria-hidden="true"><span className="page-dot is-active" /></div>
      </section>
      <div className="home-content">
        <div className="home-welcome"><div><span className="eyebrow">A LITTLE MORE YOU</span><h2>Made for your kind of night.</h2></div><button onClick={() => onGo('discover')}>Explore all <ArrowRight size={15} /></button></div>
        {progressItems.length > 0 && <ContentRail title="Continue watching" eyebrow="PICK UP WHERE YOU LEFT OFF" items={progressItems} onItemClick={onOpen} actionLabel="See all" onAction={() => onGo('continue')} />}
        {loading && <SkeletonRows count={5} />}
        {!loading && error && <ErrorState title={sections.length ? 'Some catalog sections are unavailable.' : 'Your catalog is unavailable.'} description={error} onRetry={onRetry} />}
        {!loading && sections.map((section) => <ContentRail key={section.id} title={section.title} items={section.items} onItemClick={onOpen} actionLabel="" />)}
        {!loading && !error && sections.length === 0 && <EmptyState icon={Compass} title="No catalog titles yet." description="When the configured API returns titles, they’ll appear here. VEYRA doesn’t fill empty states with sample movies." actionLabel="Search" onAction={onSearch} />}
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
              {visible.length ? <div className="poster-grid discover-grid">{visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} />)}</div> : <EmptyState icon={Compass} title="No matching titles." description={error || `There are no ${genre === 'All' ? 'catalog' : genre.toLowerCase()} titles available from the configured API.`} actionLabel={error ? 'Try again' : undefined} onAction={onRetry} />}
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
  const [suggestions, setSuggestions] = useState([]);
  const [popular, setPopular] = useState([]);
  const [canLoadMore, setCanLoadMore] = useState(false);
  const searchRef = useRef(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const term = query.trim();
    if (!term) {
      setLoading(false);
      setError('');
      setFound([]);
      setSuggestions([]);
      setCanLoadMore(false);
      return () => controller.abort();
    }
    setLoading(true);
    if (page === 1) setError('');
    const timer = window.setTimeout(async () => {
      const [searchResult, suggestionResult] = await Promise.allSettled([
        movieBoxClient.search({ query: term, subjectType: scope, page, perPage: 24, signal: controller.signal }),
        page === 1 ? movieBoxClient.getSearchSuggestions({ query: term, perPage: 10, signal: controller.signal }) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted) return;
      if (searchResult.status === 'fulfilled') {
        const pageItems = extractContentList(searchResult.value);
        setFound((current) => page === 1 ? pageItems : uniqueItems([...current, ...pageItems]));
        setCanLoadMore(pageItems.length >= 24);
        if (page === 1) setError('');
      } else {
        if (page === 1) setFound([]);
        setCanLoadMore(false);
        setError(searchResult.reason?.message || 'Search could not be completed.');
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
  const changeQuery = (value) => { setQuery(value); setPage(1); setCanLoadMore(false); };
  const setScopeFor = (value) => { setScope(value); setPage(1); setCanLoadMore(false); };
  const retry = () => setRetryVersion((value) => value + 1);
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
              const matched = typeof suggestion === 'object' ? suggestion : null;
              const label = typeof suggestion === 'string' ? suggestion : suggestion.title;
              return <button key={`${label}-${index}`} onClick={() => matched ? onOpen(matched) : changeQuery(label)}><Search size={15} /><span>{label}</span><ArrowRight size={14} /></button>;
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
                {canLoadMore && !loading && <button className="button button-outline search-load-more" onClick={() => setPage((value) => value + 1)}>Load more results <ArrowRight size={15} /></button>}
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

function EpisodeRow({ episode, onPlay, isTV = false }) {
  const episodeLabel = episode.number ? `Episode ${episode.number}` : 'Episode';
  return (
    <article className="episode-row">
      <button className="episode-thumb" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`Playback unavailable for ${episode.title}`}>
        {episode.thumbnail ? <img src={episode.thumbnail} alt="" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" />}
        <span><Play size={18} fill="currentColor" /></span>
      </button>
      <div className="episode-copy"><div className="episode-meta"><span>{episodeLabel}</span>{episode.runtime && <><i />{episode.runtime}</>}</div><h3>{episode.title}</h3>{episode.description && <p>{episode.description}</p>}</div>
      <button className="episode-play" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`Playback unavailable for ${episode.title}`}><Play size={18} fill="currentColor" /></button>
    </article>
  );
}

function DetailScreen({ item, onBack, onPlay, onToggleSaved, isSaved, onDownload, onOpen, isTV }) {
  const [details, setDetails] = useState({ content: item, seasons: [], recommendations: [], recommendationsError: '', loading: true, error: '' });
  const [selectedSeasonId, setSelectedSeasonId] = useState('');
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    if (!item?.providerItemId) {
      setDetails({ content: item, seasons: [], recommendations: [], recommendationsError: '', loading: false, error: 'This catalog item has no subjectId, so its detail endpoint cannot be requested.' });
      return () => controller.abort();
    }
    setDetails((current) => ({ ...current, content: item, loading: true, error: '' }));
    const detailPromise = movieBoxClient.getItemDetails({ subjectId: item.providerItemId, signal: controller.signal });
    const recommendationPromise = movieBoxClient.getRecommendations({ subjectId: item.providerItemId, signal: controller.signal });
    Promise.allSettled([detailPromise, recommendationPromise]).then(([detailResult, recommendationResult]) => {
      if (controller.signal.aborted) return;
      let content = item;
      let seasonsForItem = [];
      let error = '';
      if (detailResult.status === 'fulfilled') {
        const normalized = normalizeDetail(detailResult.value, item);
        content = normalized.content || item;
        seasonsForItem = normalized.seasons;
      } else error = detailResult.reason?.message || 'Unable to load title details.';
      const recommendations = recommendationResult.status === 'fulfilled' ? extractContentList(recommendationResult.value).filter((entry) => entry.id !== item.id) : [];
      const recommendationsError = recommendationResult.status === 'rejected' ? recommendationResult.reason?.message || 'Recommendations could not be loaded.' : '';
      setDetails({ content, seasons: seasonsForItem, recommendations, recommendationsError, loading: false, error });
      setSelectedSeasonId((current) => current && seasonsForItem.some((season) => season.id === current) ? current : seasonsForItem[0]?.id || '');
    });
    return () => controller.abort();
  }, [item, retryKey]);

  const content = details.content || item;
  const season = details.seasons.find((entry) => entry.id === selectedSeasonId) || details.seasons[0];
  const episodeList = season?.episodes || [];
  const isSeries = content.type === 'series';
  return (
    <main className={`detail-screen ${isTV ? 'tv-detail-screen' : ''}`}>
      <section className="detail-hero">
        {content.backdrop && <img className="detail-art" src={content.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}
        <div className="detail-art-wash" />
        <div className="detail-topline"><BackButton onClick={onBack} /><div className="detail-top-actions"><RoundButton label="Share title" onClick={() => navigator.clipboard?.writeText(content.title).catch(() => {})}><ArrowRight size={17} /></RoundButton><RoundButton label="More title information" onClick={() => document.getElementById('about-title')?.scrollIntoView({ behavior: 'smooth' })}><MoreHorizontal size={18} /></RoundButton></div></div>
        <div className="detail-hero-layout">
          <div className="detail-copy">
            <span className="detail-badge"><VeyraMark size={14} /> {content.type === 'series' ? 'SERIES' : content.type === 'movie' ? 'FILM' : 'CATALOG TITLE'}</span>
            <h1>{content.title}</h1>
            <div className="detail-meta">{content.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {content.rating}</span>}{content.year && <span>{content.year}</span>}{content.runtime && <span>{content.runtime}</span>}{content.maturity && <span className="meta-maturity">{content.maturity}</span>}</div>
            {content.genres?.length > 0 && <div className="detail-genres">{content.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>}
            <p className="detail-description">{content.synopsis || (details.loading ? 'Loading catalog details…' : 'No synopsis was provided by the catalog.')}</p>
            <div className="detail-actions">
              <ActionButton data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(content)} icon={Play}>Playback unavailable</ActionButton>
              <button data-tv-focus={isTV ? 'true' : undefined} className={`button button-glass ${isSaved(content.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(content)}>{isSaved(content.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved(content.id) ? 'In My List' : 'My List'}</button>
              <button className="round-button detail-download" data-tv-focus={isTV ? 'true' : undefined} aria-label="Downloads unavailable" title="Downloads are disabled until an authorized media source is configured" onClick={() => onDownload(content)}><Download size={17} /></button>
            </div>
            {isSeries && season?.label && <div className="detail-continue-note"><span className="live-dot" /> {season.label} <span>·</span> {episodeList.length} episodes returned</div>}
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
            <div className="rail-heading episode-heading"><div><span className="eyebrow">SEASON & EPISODE DATA</span><h2>Episodes</h2></div>{details.seasons.length > 0 && <label className="season-select"><span className="sr-only">Select season</span><select data-tv-focus={isTV ? 'true' : undefined} value={season?.id || ''} onChange={(event) => setSelectedSeasonId(event.target.value)}>{details.seasons.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select><ChevronDown size={16} /></label>}</div>
            {details.loading ? <SkeletonRows count={3} /> : episodeList.length ? <div className="episode-list">{episodeList.map((episode) => <EpisodeRow key={episode.id} episode={episode} isTV={isTV} onPlay={() => onPlay(content, episode)} />)}</div> : <EmptyState icon={Film} title="No episode data was returned." description="VEYRA will not generate sample seasons or episodes for this title." quiet />}
          </section>
        )}
        {(content.cast?.length > 0 || content.director) && <section className="cast-section"><div className="rail-heading"><div><span className="eyebrow">THE PEOPLE IN IT</span><h2>Cast & creators</h2></div>{content.director && <span className="cast-note">Directed by {content.director}</span>}</div>{content.cast?.length > 0 && <div className="cast-list">{content.cast.map((person, index) => <div className="cast-person" key={person}><span className={`cast-avatar cast-avatar-${index % 4}`}><span>{person.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span></span><span>{person}</span></div>)}</div>}</section>}
        {details.recommendationsError && <ErrorState title="Recommendations are unavailable." description={details.recommendationsError} onRetry={() => setRetryKey((value) => value + 1)} />}
        {details.recommendations.length > 0 && <ContentRail title="More like this" eyebrow="KEEP THE FEELING GOING" items={details.recommendations} onItemClick={onOpen} actionLabel="" />}
      </div>
    </main>
  );
}

function PlayerUnavailableScreen({ item, onBack }) {
  return (
    <main className="player-screen">
      <div className="player-still" />
      <div className="player-still-wash" />
      <div className="player-ui controls-visible">
        <header className="player-top"><button className="player-back" onClick={onBack} aria-label="Back to title"><ChevronLeft size={22} /><span>{item?.title || 'VEYRA'}</span></button><div className="player-top-center"><span className="player-status"><span /> PLAYBACK UNAVAILABLE</span></div><span /></header>
        <div className="player-error"><span><CloudOff size={23} /></span><h2>Playback isn’t available.</h2><p>VEYRA has no verified, authorized media source configured. No stream was requested and no playback is being simulated.</p><ActionButton onClick={onBack} icon={ChevronLeft}>Back to title</ActionButton></div>
      </div>
    </main>
  );
}

function MyListScreen({ onGo, onOpen, savedItems, onRemove }) {
  const [tab, setTab] = useState('all');
  const visible = savedItems.filter((item) => tab === 'all' || item.type === tab);
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container library-page"><PageTitle eyebrow="YOUR PRIVATE SHELF" title="My List" description="Saved references stay on this device." right={<span className="library-count">{visible.length} saved</span>} />
        <div className="library-tabs" role="tablist"><button className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')}>Everything <span>{savedItems.length}</span></button><button className={tab === 'movie' ? 'selected' : ''} onClick={() => setTab('movie')}>Movies <span>{savedItems.filter((item) => item.type === 'movie').length}</span></button><button className={tab === 'series' ? 'selected' : ''} onClick={() => setTab('series')}>Series <span>{savedItems.filter((item) => item.type === 'series').length}</span></button></div>
        {visible.length ? <div className="poster-grid library-grid">{visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} onRemove={onRemove} />)}</div> : <EmptyState icon={Heart} title="Nothing here yet." description="Save a title from the live catalog to keep its provider reference on this device." actionLabel="Explore catalog" onAction={() => onGo('discover')} />}
      </div>
    </main>
  );
}

function ContinueScreen({ onGo, onOpen, items = [], onPlay }) {
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container continue-page"><PageTitle eyebrow="PICK UP WHERE YOU LEFT OFF" title="Keep watching." description="Only real media playback can add progress here." />
      {items.length ? <div className="continue-list">{items.map(({ content, percent, remaining, label }) => <article className="continue-card" key={content.id}><button className="continue-art" onClick={() => onPlay(content)}>{content.poster && <img src={content.poster} alt="" onError={(event) => event.currentTarget.remove()} />}<span><Play size={18} fill="currentColor" /></span><ProgressBar value={percent} /></button><div className="continue-info"><span className="eyebrow">{label || (content.type === 'series' ? 'SERIES' : 'FEATURE FILM')}</span><h2>{content.title}</h2><p>{remaining || `${percent}% watched`} <span>·</span> {percent}% watched</p><div className="continue-actions"><ActionButton onClick={() => onPlay(content)} icon={Play}>Resume</ActionButton><button className="text-button" onClick={() => onOpen(content)}>View details <ArrowRight size={15} /></button></div></div></article>)}</div> : <EmptyState icon={Clock3} title="Nothing to resume." description="Continue Watching will only show positions recorded from actual playback. Playback isn’t enabled for the current API source." actionLabel="Browse catalog" onAction={() => onGo('discover')} />}
    </div></main>
  );
}

function HistoryScreen({ onGo, entries = [], onClear, onRemove }) {
  const [askClear, setAskClear] = useState(false);
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container history-page"><PageTitle eyebrow="YOUR RECENT SCREENINGS" title="Watch history" description="History is populated only by completed, real playback sessions." right={entries.length > 0 && <button className="subtle-action" onClick={() => setAskClear(true)}><Trash2 size={15} /> Clear history</button>} />
      {entries.length ? <div className="history-list">{entries.map((entry) => { const item = entry.content; if (!item) return null; return <article className="history-row" key={entry.id}><button className="history-art" onClick={() => onRemove(entry)}>{item.poster && <img src={item.poster} alt="" onError={(event) => event.currentTarget.remove()} />}<ProgressBar value={entry.percent || 0} /></button><div className="history-info"><span className="eyebrow">{entry.updatedAt ? new Date(entry.updatedAt).toLocaleString() : ''}</span><h2>{item.title}</h2><span>{entry.label || 'Playback'} <i>·</i> {entry.percent || 0}% watched</span></div><button className="history-more" aria-label={`Remove ${item.title} from history`} onClick={() => onRemove(entry)}><X size={16} /></button></article>; })}</div> : <EmptyState icon={History} title="Your story starts here." description="No playback history has been recorded on this device." actionLabel="Browse catalog" onAction={() => onGo('discover')} />}
      </div>
      {askClear && <ConfirmDialog title="Clear your watch history?" description="This removes locally stored playback history. Your saved list won’t change." confirmLabel="Clear history" onCancel={() => setAskClear(false)} onConfirm={() => { onClear(); setAskClear(false); }} />}
    </main>
  );
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }) {
  return <div className="dialog-backdrop" role="presentation" onClick={onCancel}><section className="confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><span className="dialog-icon"><Trash2 size={19} /></span><h2>{title}</h2><p>{description}</p><div><button className="button button-outline" onClick={onCancel}>Cancel</button><button className="button button-danger" onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

function DownloadsScreen({ onGo }) {
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container downloads-page"><PageTitle eyebrow="OFFLINE MEDIA" title="Downloads" description="Downloads are disabled until an authorized media provider is configured." right={<span className="download-mode-pill"><WifiOff size={14} /> Not connected</span>} />
      <EmptyState icon={Download} title="No downloads are available." description="The supplied API includes download and proxy routes, but its implementation uses upstream identity spoofing and public relay fallbacks. VEYRA will not request or store those media links without authorization." actionLabel="Browse catalog" onAction={() => onGo('discover')} />
    </div></main>
  );
}

function ProfileScreen({ onGo, user, isOffline }) {
  const profileLinks = [
    { title: 'Continue watching', detail: 'Real playback positions only', icon: Play, route: 'continue' },
    { title: 'Watch history', detail: 'Sessions recorded from actual playback', icon: History, route: 'history' },
    { title: 'My List', detail: 'References saved on this device', icon: Heart, route: 'list' },
    { title: 'Downloads', detail: 'Offline media is not connected', icon: Download, route: 'downloads' },
  ];
  const settingsLinks = [
    { title: 'Preferences', detail: 'Language and appearance', icon: Settings, route: 'settings' },
    { title: 'Devices', detail: 'Device account service is not configured', icon: MonitorPlay, route: 'devices' },
    { title: 'Notifications', detail: 'No notification service is connected', icon: Bell, route: 'notifications' },
    { title: 'About VEYRA', detail: 'Version 1.0.0 · Made for stories', icon: CircleHelp, route: 'settings' },
  ];
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container profile-page"><PageTitle eyebrow="YOUR VEYRA" title="A little more you." description="Your local preferences and saved catalog references." />
      <section className="profile-card"><div className="profile-avatar">{user?.name?.slice(0, 1)?.toUpperCase() || 'G'}<span /></div><div className="profile-identity"><span className="eyebrow">LOCAL PROFILE</span><h2>{user?.name || 'Guest'}</h2><p>{user?.email || 'Saved preferences stay on this device'}</p></div><button className="profile-edit" onClick={() => onGo('settings')}>Preferences <ChevronRight size={15} /></button><div className="profile-plan"><VeyraMark size={18} /><span>VEYRA<small>LOCAL</small></span><i /> <strong>Catalog access varies by API</strong></div></section>
      <div className="profile-columns"><section><SectionLabel>YOUR LIBRARY</SectionLabel><div className="profile-link-list">{profileLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section><section><SectionLabel>APP & SERVICES</SectionLabel><div className="profile-link-list">{settingsLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section></div>
      <div className="profile-quick-actions"><button onClick={() => onGo('tv-home')}><Tv size={17} /><span><strong>Open TV experience</strong><small>Explore VEYRA on the big screen</small></span><ChevronRight size={16} /></button><div className="profile-link-row"><span className="profile-link-icon">{isOffline ? <WifiOff size={17} /> : <Wifi size={17} />}</span><span><strong>{isOffline ? 'Offline' : 'Online'}</strong><small>{isOffline ? 'No network connection detected' : 'Network connection detected'}</small></span></div></div>
    </div></main>
  );
}

function SettingsScreen({ onGo, settings, setSettings }) {
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const rows = [
    { title: 'Language', detail: 'App language', key: 'language', options: ['English', 'Español', 'Français', 'العربية'], icon: Languages },
    { title: 'Appearance', detail: 'Keep the cinema dark', key: 'appearance', options: ['Dark', 'System'], icon: Moon },
  ];
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container settings-page"><button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Profile</button><PageTitle eyebrow="MAKE IT YOURS" title="Settings" description="A few small things that make VEYRA feel like your cinema." />
      <section className="settings-group"><SectionLabel>APP PREFERENCES</SectionLabel>{rows.map(({ title, detail, key, options, icon: Icon }) => <div className="settings-row" key={key}><span className="setting-symbol"><Icon size={17} /></span><span className="setting-copy"><strong>{title}</strong><small>{detail}</small></span><label className="setting-select"><select aria-label={title} value={settings[key]} onChange={(event) => update(key, event.target.value)}>{options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label></div>)}
      </section>
      <section className="settings-group"><SectionLabel>PLAYBACK</SectionLabel><p className="settings-disclaimer">Playback quality and subtitle options are not shown until a verified media provider returns supported tracks. No client-side credentials are stored.</p></section>
      <section className="settings-group"><SectionLabel>ACCOUNT & PRIVACY</SectionLabel><button className="settings-link-row" onClick={() => onGo('devices')}><span className="setting-symbol"><MonitorPlay size={17} /></span><span className="setting-copy"><strong>Manage devices</strong><small>No account/device service is connected</small></span><ChevronRight size={17} /></button><button className="settings-link-row" onClick={() => onGo('downloads')}><span className="setting-symbol"><HardDrive size={17} /></span><span className="setting-copy"><strong>Storage & downloads</strong><small>Offline media is not connected</small></span><ChevronRight size={17} /></button></section>
      <p className="settings-disclaimer">My List and app preferences are saved locally. VEYRA does not provide sign-in, playback, or download services in this build.</p>
    </div></main>
  );
}

function DevicesScreen({ onGo }) {
  return <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container devices-page"><button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Profile</button><PageTitle eyebrow="YOUR CONNECTED CINEMAS" title="Devices" description="Device management requires an account service." /><EmptyState icon={MonitorPlay} title="No account service is connected." description="VEYRA does not invent device sessions or claim that other devices are signed in." actionLabel="Back to profile" onAction={() => onGo('profile')} /></div></main>;
}

function NotificationsScreen({ onGo }) {
  return <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container notifications-page"><PageTitle eyebrow="A STORY WORTH A TAP" title="Notifications" description="Only connected services can create account notifications." /><EmptyState icon={Bell} title="No notifications yet." description="The MovieBox API does not expose a user notification endpoint." actionLabel="Find a story" onAction={() => onGo('discover')} /></div></main>;
}

function OfflineScreen({ onGo, onTryAgain }) {
  return (
    <main className="offline-screen"><div className="offline-top"><Brand onClick={() => onGo('home')} /><span className="offline-mode"><span /> OFFLINE MODE</span></div><div className="offline-orbit" /><div className="offline-content"><span className="offline-icon"><WifiOff size={24} /></span><span className="eyebrow">A SMALL PAUSE</span><h1>You’re<br /><em>offline.</em></h1><p>Catalog requests are unavailable without a connection. No offline video files are configured on this device.</p><ActionButton onClick={() => onGo('downloads')} icon={Download}>View downloads</ActionButton><button className="offline-retry" onClick={onTryAgain}><Wifi size={15} /> Try reconnecting</button></div><div className="offline-bottom"><span>Offline media is not configured</span><button onClick={() => onGo('profile')}>Profile <ArrowRight size={14} /></button></div></main>
  );
}

function TVHomeScreen({ onGo, onOpen, onPlay, onSearch, onProfile, featured, sections = [], loading, error, onRetry }) {
  const hero = featured || sections.flatMap((section) => section.items || [])[0] || null;
  return (
    <main className="tv-home-screen">
      <aside className="tv-sidebar"><Brand onClick={() => onGo('tv-home')} data-tv-focus="true" /><nav><button className="tv-nav-active" data-tv-focus="true" onClick={() => onGo('tv-home')}><span><Play size={18} /></span>Home</button><button data-tv-focus="true" onClick={onSearch}><span><Search size={18} /></span>Search</button><button data-tv-focus="true" onClick={() => onGo('list')}><span><Heart size={18} /></span>My List</button><button data-tv-focus="true" onClick={onProfile}><span><UserRound size={18} /></span>Profile</button></nav><div className="tv-sidebar-bottom"><span className="tv-avatar">G</span><span>Guest</span><button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ArrowRight size={14} /></button></div></aside>
      <div className="tv-main"><div className="tv-topline"><span className="tv-now"><span /> {loading ? 'CONNECTING TO CATALOG' : error ? 'CATALOG UNAVAILABLE' : 'YOUR EVENING, CURATED'}</span><div><span className="tv-clock">VEYRA</span><button data-tv-focus="true" onClick={onProfile} aria-label="Open profile"><UserRound size={17} /></button></div></div>
        <section className="tv-feature" style={{ '--feature-art': hero?.backdrop ? `url('${hero.backdrop}')` : 'none' }}><div className="tv-feature-wash" /><div className="tv-feature-copy"><span className="eyebrow"><VeyraMark size={14} /> {hero ? 'FROM YOUR CATALOG' : 'YOUR PRIVATE CINEMA'}</span><h1>{hero ? hero.title : <>Your next<br /><em>story.</em></>}</h1><p>{hero?.synopsis || error || (loading ? 'Finding stories from your catalog.' : 'Connect an authorized catalog API to start browsing.')}</p><div className="tv-meta">{hero?.rating && <span><Star size={13} fill="currentColor" /> {hero.rating}</span>}{hero?.year && <span>{hero.year}</span>}{hero?.runtime && <span>{hero.runtime}</span>}</div><div className="tv-feature-actions">{hero ? <><button className="button button-primary" data-tv-focus="true" onClick={() => onPlay(hero)}><Play size={16} fill="currentColor" /> Playback unavailable</button><button className="button button-glass" data-tv-focus="true" onClick={() => onOpen(hero)}>Explore title <ArrowRight size={15} /></button></> : <><button className="button button-primary" data-tv-focus="true" onClick={onSearch}><Search size={16} /> Search catalog</button>{error && <button className="button button-glass" data-tv-focus="true" onClick={onRetry}>Try again</button>}</>}</div></div><span className="tv-feature-aside">VEYRA <i>CATALOG</i></span></section>
        <section className="tv-rails">{loading ? <SkeletonRows count={3} /> : sections.map((section) => <ContentRail key={section.id} title={section.title} items={section.items} onItemClick={onOpen} tvFocus compact actionLabel="" />)}</section>
      </div><div className="tv-remote-hint tv-home-hint"><span>↑↓ MOVE</span><span>OK SELECT</span><span>BACK RETURN</span></div>
    </main>
  );
}

function TVProfile({ onGo }) {
  return <div className="tv-profile-popover"><div className="tv-avatar">G</div><strong>Guest</strong><small>Local profile · no account service</small><button data-tv-focus="true" onClick={() => onGo('profile')}>Preferences <ChevronRight size={14} /></button><button data-tv-focus="true" onClick={() => onGo('devices')}>Devices <ChevronRight size={14} /></button><button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ArrowRight size={14} /></button></div>;
}

export default function App() {
  const [view, setView] = useState(() => initialRoute());
  const [showSplash, setShowSplash] = useState(true);
  const [selectedTitle, setSelectedTitle] = useState(null);
  const [detailFrom, setDetailFrom] = useState('home');
  const [playerFrom, setPlayerFrom] = useState('home');
  const [playbackItem, setPlaybackItem] = useState(null);
  const [homeData, setHomeData] = useState({ loading: true, error: '', featured: null, sections: [] });
  const [savedItems, setSavedItems] = useState(readSavedReferences);
  const [history, setHistory] = useState([]);
  const [settings, setSettings] = useState(readSettings);
  const [user] = useState({ name: 'Guest', email: '' });
  const [selectedType, setSelectedType] = useState('all');
  const [toast, setToast] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const toastTimer = useRef(null);
  const [tvProfileOpen, setTvProfileOpen] = useState(false);

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

    const homepage = results[0];
    if (homepage.status === 'fulfilled') {
      const homepageSections = extractContentSections(homepage.value);
      homepageSections.forEach((section) => addSection(section.title, section.items));
      if (!homepageSections.length) addSection('Featured from your catalog', extractContentList(homepage.value));
    }
    const trending = results[1];
    if (trending.status === 'fulfilled') addSection('Trending now', extractContentList(trending.value));
    const hot = results[2];
    if (hot.status === 'fulfilled') addSection('Hot movies & series', extractContentList(hot.value));

    const catalog = uniqueItems(sections.flatMap((section) => section.items));
    const succeeded = results.some((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    let error = '';
    if (!succeeded) error = failures[0]?.reason?.message || 'The catalog could not be loaded.';
    else if (!catalog.length) error = 'The API responded, but returned no titles with the identifiers and fields VEYRA needs.';
    else if (failures.length) error = `Some catalog sections could not be loaded: ${failures.map((result) => result.reason?.message).filter(Boolean).join(' ')}`;
    setHomeData({ loading: false, error, featured: catalog[0] || null, sections, catalog });
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
  useEffect(() => writeStore('veyra-list:v2', savedItems), [savedItems]);
  useEffect(() => writeStore('veyra-history:v2', history), [history]);
  useEffect(() => writeStore('veyra-settings:v2', settings), [settings]);
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
        setView('search');
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, []);

  const notify = useCallback((message) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 3200);
  }, []);
  const dismissToast = () => { setToast(''); window.clearTimeout(toastTimer.current); };
  const go = (destination) => {
    setView(destination);
    setTvProfileOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const onSearch = () => go('search');
  const onOpenTitle = (item) => {
    if (!item) return;
    const from = view === 'detail' || view === 'tv-detail' ? detailFrom : view;
    setDetailFrom(from);
    setSelectedTitle(item);
    setView(from.startsWith('tv') ? 'tv-detail' : 'detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goBackFromDetail = () => go(detailFrom || 'home');
  const startPlayer = (item = selectedTitle) => {
    setPlaybackItem(item || selectedTitle);
    setPlayerFrom(view);
    setView(view.startsWith('tv') ? 'tv-playback-unavailable' : 'playback-unavailable');
    window.scrollTo({ top: 0, behavior: 'smooth' });
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
  const downloadTitle = () => {
    notify('Downloads are unavailable until an authorized media provider is configured.');
  };
  const catalogItems = useMemo(() => uniqueItems(homeData.sections.flatMap((section) => section.items || [])), [homeData.sections]);
  const continueItems = useMemo(() => history
    .filter((entry) => entry.content && !entry.completed && Number(entry.percent) > 0)
    .map((entry) => ({ content: entry.content, percent: entry.percent, remaining: entry.remaining, label: entry.label })), [history]);
  const unreadCount = 0;

  useEffect(() => {
    if (!view.startsWith('tv')) return undefined;
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
        if (view === 'tv-playback-unavailable') go(playerFrom || 'home');
        else if (view === 'tv-detail') goBackFromDetail();
        else if (view === 'tv-home') go('home');
      }
    };
    document.addEventListener('keydown', handleRemote);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener('keydown', handleRemote); };
  }, [view, detailFrom, playerFrom]);

  const homeProps = {
    onGo: go,
    onSearch,
    onNotifications: () => go('notifications'),
    onProfile: () => go('profile'),
    onOpen: onOpenTitle,
    onPlay: startPlayer,
    isSaved,
    onToggleSaved: toggleSaved,
    featured: homeData.featured,
    sections: homeData.sections,
    progressItems: continueItems.map((entry) => entry.content),
    loading: homeData.loading,
    error: homeData.error,
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
    screen = <DetailScreen item={selectedTitle} onBack={goBackFromDetail} onPlay={(item) => startPlayer(item)} onToggleSaved={toggleSaved} isSaved={isSaved} onDownload={downloadTitle} onOpen={onOpenTitle} isTV={view === 'tv-detail'} />;
  } else if (view === 'playback-unavailable' || view === 'tv-playback-unavailable') {
    screen = <PlayerUnavailableScreen item={playbackItem} onBack={() => go(playerFrom || 'home')} />;
  } else if (view === 'list') {
    screen = <MyListScreen onGo={go} onOpen={onOpenTitle} savedItems={savedItems} onRemove={(item) => { setSavedItems((current) => current.filter((entry) => entry.id !== item.id)); notify(`${item.title} removed from My List`); }} />;
  } else if (view === 'continue') {
    screen = <ContinueScreen onGo={go} onOpen={onOpenTitle} onPlay={startPlayer} items={continueItems} />;
  } else if (view === 'history') {
    screen = <HistoryScreen onGo={go} entries={history} onClear={() => setHistory([])} onRemove={(entry) => setHistory((current) => current.filter((item) => item.id !== entry.id))} />;
  } else if (view === 'downloads') {
    screen = <DownloadsScreen onGo={go} />;
  } else if (view === 'profile') {
    screen = <ProfileScreen onGo={go} user={user} isOffline={isOffline} />;
  } else if (view === 'settings') {
    screen = <SettingsScreen onGo={go} settings={settings} setSettings={setSettings} />;
  } else if (view === 'devices') {
    screen = <DevicesScreen onGo={go} />;
  } else if (view === 'notifications') {
    screen = <NotificationsScreen onGo={go} />;
  } else if (view === 'offline') {
    screen = <OfflineScreen onGo={go} onTryAgain={() => {
      const online = typeof navigator !== 'undefined' ? navigator.onLine : true;
      setIsOffline(!online);
      if (online) { go('home'); loadHome(); }
      else notify('This device is still offline.');
    }} />;
  } else if (view === 'tv-home') {
    screen = <TVHomeScreen onGo={go} onOpen={onOpenTitle} onPlay={startPlayer} onSearch={onSearch} onProfile={() => setTvProfileOpen((value) => !value)} featured={homeData.featured} sections={homeData.sections} loading={homeData.loading} error={homeData.error} onRetry={() => loadHome()} />;
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
      {isOffline && !['offline'].includes(view) && <button className="offline-indicator" onClick={() => go('offline')}><WifiOff size={13} /> Offline</button>}
      <Toast message={toast} onClose={dismissToast} />
      {showSplash && <div className="splash-screen"><VeyraMark size={46} /><span>VEYRA</span><small>WATCH WHAT MOVES YOU</small><i /></div>}
      <span className="sr-only" aria-live="polite">{unreadCount ? `${unreadCount} unread notifications` : ''}</span>
    </div>
  );
}
