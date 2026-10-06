import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  CloudOff,
  Compass,
  Download,
  Eye,
  EyeOff,
  Film,
  HardDrive,
  Heart,
  History,
  Languages,
  ListVideo,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Monitor,
  MonitorPlay,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  Subtitles,
  Trash2,
  Tv,
  UserRound,
  Volume2,
  VolumeX,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  BackButton,
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
import {
  genres,
  initialDownloads,
  initialHistory,
  initialNotifications,
  movies,
  railData,
  seasons,
  series,
  titleById,
  titles,
  watchProgress as seededProgress,
} from './data';
import './styles.css';

const DEFAULT_SETTINGS = {
  quality: 'Auto',
  subtitles: 'English',
  autoplay: true,
  notifications: true,
  mobileData: false,
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

function formatTime(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return hrs > 0
    ? `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${mins}:${String(secs).padStart(2, '0')}`;
}

function getItems(ids = []) {
  return ids.map((id) => titleById[id]).filter(Boolean);
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

function Toggle({ value, onChange, label }) {
  return <button type="button" className={`toggle ${value ? 'toggle-on' : ''}`} role="switch" aria-checked={value} aria-label={label} onClick={() => onChange(!value)}><span /></button>;
}

function SectionLabel({ children, trailing }) {
  return <div className="section-label"><span>{children}</span>{trailing}</div>;
}

function BottomSheet({ title, subtitle, onClose, children, className = '', isTV = false }) {
  if (!title) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <section className={`bottom-sheet ${className}`} role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <span className="sheet-grabber" />
        <div className="sheet-heading"><div><span className="eyebrow">VEYRA PLAYER</span><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><RoundButton label="Close" onClick={onClose} data-tv-focus={isTV ? 'true' : undefined}><X size={18} /></RoundButton></div>
        {children}
      </section>
    </div>
  );
}

function AuthScreen({ mode, onMode, onDone, onBack }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const isSignUp = mode === 'signup';
  const isForgot = mode === 'forgot';
  const isWelcome = mode === 'welcome';

  const submit = (event) => {
    event.preventDefault();
    setError('');
    if (isForgot) {
      if (!email.includes('@')) return setError('Enter a valid email address to continue.');
      setSent(true);
      return;
    }
    if (!email.includes('@')) return setError('Enter a valid email address.');
    if (password.length < 6) return setError('Your password must be at least 6 characters.');
    onDone({ name: isSignUp ? name.trim() || 'Alex Morgan' : email.split('@')[0], email });
  };

  return (
    <main className={`auth-screen ${isWelcome ? 'auth-welcome' : ''}`}>
      <div className="auth-art" style={{ backgroundImage: `url('/art/hero-last-signal.jpg')` }} />
      <div className="auth-shade" />
      <div className="auth-top"><Brand onClick={onBack} /><span className="auth-private"><span /> A private cinema, just for you</span></div>
      <div className="auth-copy">
        <span className="eyebrow">VEYRA ORIGINALS</span>
        <h1>Stories stay<br /><em>with you.</em></h1>
        <p>Watch what moves you.</p>
        <div className="auth-art-caption"><span>01 — 04</span><span>The Last Signal <i>·</i> A VEYRA Original</span></div>
      </div>
      {isWelcome ? (
        <section className="auth-panel welcome-panel">
          <span className="eyebrow">WELCOME TO VEYRA</span>
          <h2>Your next story<br />is waiting.</h2>
          <p>A private cinema that lives inside your phone and TV.</p>
          <ActionButton onClick={() => onDone({ name: 'Alex Morgan', email: 'alex@example.com' })} icon={Play}>Explore VEYRA</ActionButton>
          <div className="auth-panel-foot"><span>Already a member?</span><button onClick={() => onMode('signin')}>Sign in <ArrowRight size={14} /></button></div>
          <button className="guest-link" onClick={() => onDone({ name: 'Guest', email: 'guest@veyra.local' })}>Continue as guest</button>
        </section>
      ) : (
        <section className="auth-panel">
          <button className="auth-back" onClick={onBack}><ArrowLeft size={16} /> Back to VEYRA</button>
          <span className="eyebrow">{isForgot ? 'ACCOUNT RECOVERY' : isSignUp ? 'YOUR SEAT IS WAITING' : 'GOOD TO HAVE YOU BACK'}</span>
          <h2>{isForgot ? 'Reset password' : isSignUp ? 'Create your account' : 'Welcome back.'}</h2>
          <p className="auth-subtitle">{isForgot ? 'We’ll send a reset link to your email.' : isSignUp ? 'One account. All the stories you love.' : 'Sign in to pick up where you left off.'}</p>
          {sent ? (
            <div className="auth-success"><span className="success-orb"><Mail size={21} /></span><h3>Check your inbox.</h3><p>A reset link is on its way to <strong>{email}</strong>.</p><button onClick={() => { setSent(false); onMode('signin'); }}>Back to sign in <ArrowRight size={14} /></button></div>
          ) : (
            <form className="auth-form" onSubmit={submit}>
              {isSignUp && <label>Your name<div className="input-wrap"><UserRound size={17} /><input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" placeholder="Alex Morgan" /></div></label>}
              <label>Email address<div className="input-wrap"><Mail size={17} /><input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" type="email" placeholder="you@example.com" /></div></label>
              {!isForgot && <label>Password<div className="input-wrap"><LockKeyhole size={17} /><input value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isSignUp ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} placeholder="At least 6 characters" /><button className="input-trailing" type="button" onClick={() => setShowPassword(!showPassword)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label>}
              {error && <p className="form-error">{error}</p>}
              {!isForgot && !isSignUp && <button className="forgot-link" type="button" onClick={() => onMode('forgot')}>Forgot password?</button>}
              <ActionButton type="submit" className="auth-submit">{isForgot ? 'Send reset link' : isSignUp ? 'Create account' : 'Sign in'}<ArrowRight size={16} /></ActionButton>
              <div className="auth-divider"><span /> <i>or</i> <span /></div>
              <button className="button button-outline" type="button" onClick={() => onDone({ name: 'Guest', email: 'guest@veyra.local' })}>Continue as guest</button>
            </form>
          )}
          {!isForgot && <div className="auth-panel-foot"><span>{isSignUp ? 'Already have an account?' : 'New to VEYRA?'}</span><button onClick={() => onMode(isSignUp ? 'signin' : 'signup')}>{isSignUp ? 'Sign in' : 'Create account'} <ArrowRight size={14} /></button></div>}
        </section>
      )}
      <div className="auth-footer"><span>© 2026 VEYRA</span><span>Stories worth staying for.</span><a href="#privacy" onClick={(event) => event.preventDefault()}>Privacy & terms</a></div>
    </main>
  );
}

function HomeScreen({ onGo, onSearch, onNotifications, onProfile, onOpen, onPlay, isSaved, onToggleSaved }) {
  const progressFor = (id) => seededProgress[id]?.percent;
  return (
    <main className="home-page">
      <div className="home-hero-art"><img src="/art/hero-last-signal.jpg" alt="A lone figure beneath a red aurora" /></div>
      <div className="home-hero-gradient" />
      <TopBar isHome active="home" onGo={onGo} onSearch={onSearch} onNotifications={onNotifications} onProfile={onProfile} />
      <section className="home-hero">
        <div className="hero-content">
          <div className="hero-kicker"><span className="original-mark"><VeyraMark size={15} /></span> VEYRA ORIGINAL <span className="kicker-divider" /> NEW FILM · 2026</div>
          <h1>The Last<br /><em>Signal.</em></h1>
          <p className="hero-description">Somewhere in the static, someone is trying to reach us.</p>
          <div className="hero-meta"><span className="rating-chip"><Star size={12} fill="currentColor" /> 8.6</span><span>2026</span><span>2h 08m</span><span className="meta-maturity">16+</span><span>Sci-Fi · Mystery</span></div>
          <div className="hero-actions">
            <button className="button button-primary hero-watch" onClick={() => onPlay(titleById['last-signal'])}><Play size={16} fill="currentColor" /> Watch now</button>
            <button className={`button button-glass hero-list ${isSaved('last-signal') ? 'is-saved' : ''}`} onClick={() => onToggleSaved(titleById['last-signal'])}>{isSaved('last-signal') ? <Check size={16} /> : <Plus size={17} />}{isSaved('last-signal') ? 'In My List' : 'My List'}</button>
            <button className="hero-more" onClick={() => onOpen(titleById['last-signal'])}>Explore title <ArrowRight size={15} /></button>
          </div>
        </div>
        <div className="hero-bottom-note"><span className="hero-index">01</span><span className="hero-rule" /><span>TONIGHT’S PREMIERE</span></div>
        <div className="hero-pagination"><span className="page-dot is-active" /><span className="page-dot" /><span className="page-dot" /><span className="page-dot" /></div>
      </section>
      <div className="home-content">
        <div className="home-welcome"><div><span className="eyebrow">A LITTLE MORE YOU</span><h2>Made for your kind of night.</h2></div><button onClick={() => onGo('discover')}>Explore all <ArrowRight size={15} /></button></div>
        <ContentRail title="Continue watching" eyebrow="PICK UP WHERE YOU LEFT OFF" items={getItems(railData.continue)} onItemClick={onOpen} progressFor={progressFor} actionLabel="See all" onAction={() => onGo('continue')} />
        <ContentRail title="Trending now" items={getItems(railData.trending)} onItemClick={onOpen} actionLabel="Discover" onAction={() => onGo('discover')} />
        <ContentRail title="Popular movies" items={getItems(railData.popularMovies)} onItemClick={onOpen} actionLabel="View all" onAction={() => onGo('discover')} />
        <ContentRail title="Series worth staying up for" items={getItems(railData.popularSeries)} onItemClick={onOpen} actionLabel="View all" onAction={() => onGo('discover')} />
        <ContentRail title="Because you watched Northbound" eyebrow="A GOOD NEXT CHAPTER" items={getItems(railData.because)} onItemClick={onOpen} />
        <div className="home-footer"><Brand compact onClick={() => onGo('home')} /><span>Stories worth staying for.</span><button onClick={() => onGo('settings')}>Preferences</button></div>
      </div>
    </main>
  );
}

function DiscoverScreen({ onGo, onOpen, selectedType, setSelectedType }) {
  const [genre, setGenre] = useState('All');
  const visible = (selectedType === 'movies' ? movies : selectedType === 'series' ? series : titles)
    .filter((item) => genre === 'All' || item.genres.includes(genre));
  return (
    <main className="page-screen discover-screen">
      <TopBar active="discover" onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container discover-content">
        <div className="discover-intro"><span className="eyebrow">A WORLD OF GOOD STORIES</span><h1>Find your next<br /><em>obsession.</em></h1><p>Less scrolling. More feeling.</p><div className="discover-orbit orbit-one" /><div className="discover-orbit orbit-two" /><span className="discover-stamp">CURATED<br />FOR YOU <Sparkles size={14} /></span></div>
        <div className="discover-controls">
          <div className="segmented" role="tablist" aria-label="Content type">{[['all', 'Everything'], ['movies', 'Movies'], ['series', 'Series']].map(([id, label]) => <button key={id} className={selectedType === id ? 'selected' : ''} onClick={() => setSelectedType(id)} role="tab" aria-selected={selectedType === id}>{label}</button>)}</div>
          <div className="genre-scroll">{genres.map((item) => <button key={item} className={`genre-chip ${genre === item ? 'genre-active' : ''}`} onClick={() => setGenre(item)}>{item}</button>)}</div>
        </div>
        {genre === 'All' && selectedType !== 'series' && <ContentRail title="The week, in stories" eyebrow="TRENDING" items={getItems(railData.trending.filter((id) => selectedType === 'all' || titleById[id]?.type === 'movie'))} onItemClick={onOpen} actionLabel="" />}
        {genre === 'All' && selectedType !== 'series' && <ContentRail title="A little momentum" eyebrow="ACTION" items={getItems(['mile-marker', 'last-signal'])} onItemClick={onOpen} actionLabel="" />}
        {genre === 'All' && selectedType !== 'series' && <ContentRail title="Something lighter tonight" eyebrow="COMEDY" items={getItems(['good-company'])} onItemClick={onOpen} actionLabel="" />}
        {genre === 'All' && selectedType !== 'series' && <ContentRail title="Worlds beyond this one" eyebrow="SCI-FI" items={getItems(['quiet-earth', 'last-signal', 'thin-air'])} onItemClick={onOpen} actionLabel="" />}
        {genre === 'All' && selectedType !== 'movies' && <ContentRail title="The next episode is calling" eyebrow="SERIES TO GET LOST IN" items={getItems(railData.popularSeries)} onItemClick={onOpen} actionLabel="" />}
        {genre === 'All' && selectedType !== 'movies' && <ContentRail title="Drawn worlds, lasting wonder" eyebrow="ANIME" items={getItems(['paper-atlas'])} onItemClick={onOpen} actionLabel="" />}
        {genre === 'All' && <ContentRail title="Freshly added" eyebrow="NEW RELEASES" items={getItems(railData.newReleases)} onItemClick={onOpen} actionLabel="" />}
        {genre === 'All' && <ContentRail title="The ones that stay with you" eyebrow="TOP RATED" items={getItems(railData.topRated)} onItemClick={onOpen} actionLabel="" />}
        <section className="discover-filtered">
          <div className="rail-heading"><div><span className="eyebrow">{genre === 'All' ? 'ALL YOUR NEXTS' : `A LITTLE ${genre.toUpperCase()}`}</span><h2>{genre === 'All' ? (selectedType === 'movies' ? 'Movies' : selectedType === 'series' ? 'Series' : 'Every story, in one place') : `${genre} picks`}</h2></div><span className="result-count">{visible.length} titles</span></div>
          {visible.length ? <div className="poster-grid discover-grid">{visible.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} />)}</div> : <EmptyState icon={Compass} title="A new story is on its way." description={`We’re still finding the right ${genre.toLowerCase()} for you.`} />}
        </section>
        <ContentRail title="A few hidden gems" eyebrow="OFF THE BEATEN PATH" items={getItems(['small-hours', 'afterlight', 'the-deep-blue', 'thin-air'])} onItemClick={onOpen} actionLabel="" />
      </div>
    </main>
  );
}

function SearchScreen({ onGo, onOpen }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState('all');
  const searchRef = useRef(null);
  useEffect(() => {
    if (!query.trim()) { setLoading(false); return undefined; }
    setLoading(true);
    const timer = window.setTimeout(() => setLoading(false), 250);
    return () => window.clearTimeout(timer);
  }, [query]);
  useEffect(() => { searchRef.current?.focus(); }, []);
  const found = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return [];
    return titles.filter((item) => (scope === 'all' || item.type === scope) && `${item.title} ${item.genres.join(' ')} ${item.cast.join(' ')}`.toLowerCase().includes(term));
  }, [query, scope]);
  const suggestions = useMemo(() => {
    if (!query.trim()) return [];
    const term = query.toLowerCase();
    return titles.filter((item) => `${item.title} ${item.genres.join(' ')}`.toLowerCase().includes(term)).slice(0, 4);
  }, [query]);
  const trending = ['The Last Signal', 'Northbound', 'Mystery', 'Sci-Fi'];
  return (
    <main className="page-screen search-screen">
      <TopBar onGo={onGo} onSearch={() => searchRef.current?.focus()} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container search-content">
        <div className="search-heading"><span className="eyebrow">A GOOD PLACE TO START</span><h1>What are you<br /><em>in the mood for?</em></h1></div>
        <div className="search-field-wrap"><Search size={20} /><input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search movies, series, people..." aria-label="Search movies and series" />{query && <button onClick={() => setQuery('')} aria-label="Clear search"><X size={17} /></button>}<kbd>⌘ K</kbd></div>
        <div className="search-scopes" role="tablist" aria-label="Search in">{[['all', 'Everything'], ['movie', 'Movies'], ['series', 'Series']].map(([id, label]) => <button key={id} className={scope === id ? 'scope-active' : ''} onClick={() => setScope(id)} role="tab" aria-selected={scope === id}>{label}</button>)}</div>
        {!query.trim() ? (
          <>
            <SearchEmpty />
            <div className="trending-searches"><SectionLabel>SEARCHES PEOPLE LOVE</SectionLabel><div>{trending.map((word, index) => <button key={word} onClick={() => setQuery(word)}><span>0{index + 1}</span>{word}<ArrowRight size={14} /></button>)}</div></div>
            <ContentRail title="Popular tonight" items={getItems(railData.trending.slice(0, 4))} onItemClick={onOpen} actionLabel="" />
          </>
        ) : (
          <>
            {suggestions.length > 0 && <div className="suggestion-list"><span className="eyebrow">QUICK MATCHES</span>{suggestions.map((item) => <button key={item.id} onClick={() => onOpen(item)}><Search size={15} /><span>{item.title}</span><small>{item.type === 'series' ? 'Series' : item.year}</small><ArrowRight size={14} /></button>)}</div>}
            {loading ? <SkeletonRows count={4} /> : found.length ? (
              <>
                {scope === 'all' ? <>
                  {found.some((item) => item.type === 'movie') && <SearchResultsGroup title="Movies" items={found.filter((item) => item.type === 'movie')} onOpen={onOpen} />}
                  {found.some((item) => item.type === 'series') && <SearchResultsGroup title="Series" items={found.filter((item) => item.type === 'series')} onOpen={onOpen} />}
                </> : <SearchResultsGroup title={scope === 'movie' ? 'Movies' : 'Series'} items={found} onOpen={onOpen} />}
              </>
            ) : <EmptyState icon={Search} eyebrow="NO MATCHES JUST YET" title="Nothing came up." description={`We couldn’t find “${query}”. Try a title, genre, or a different spelling.`} actionLabel="Clear search" onAction={() => setQuery('')} />}
          </>
        )}
      </div>
    </main>
  );
}

function SearchResultsGroup({ title, items, onOpen }) {
  return <section className="search-results-group"><div className="rail-heading"><div><span className="eyebrow">{title === 'Movies' ? 'FEATURE FILMS' : 'BIGGER STORIES'}</span><h2>{title}</h2></div><span className="result-count">{items.length} results</span></div><div className="search-result-list">{items.map((item) => <button className="search-result-row" key={item.id} onClick={() => onOpen(item)}><img src={item.poster} alt="" /><span className="search-result-copy"><strong>{item.title}</strong><span>{item.year} · {item.genres.join(' / ')}</span><small>{item.synopsis}</small></span><span className="result-rating"><Star size={12} fill="currentColor" /> {item.rating}</span><ArrowRight className="result-arrow" size={17} /></button>)}</div></section>;
}

function EpisodeRow({ episode, onPlay, active = false, isTV = false }) {
  return (
    <article className={`episode-row ${active ? 'episode-current' : ''}`}>
      <button className="episode-thumb" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`Play ${episode.name}`}><img src={episode.thumbnail} alt="" /><span><Play size={18} fill="currentColor" /></span>{episode.progress > 0 && episode.progress < 100 && <ProgressBar value={episode.progress} />}{episode.progress >= 100 && <span className="episode-watched"><Check size={11} /></span>}</button>
      <div className="episode-copy"><div className="episode-meta"><span>{episode.number}</span><i />{episode.runtime}{active && <em>CONTINUE WATCHING</em>}</div><h3>{episode.name}</h3><p>{episode.description}</p>{episode.progress > 0 && episode.progress < 100 && <div className="episode-progress-copy"><ProgressBar value={episode.progress} /><span>{episode.progress}% watched</span></div>}</div>
      <button className="episode-play" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(episode)} aria-label={`Play ${episode.name}`}><Play size={18} fill="currentColor" /></button>
    </article>
  );
}

function DetailScreen({ item, onBack, onPlay, onToggleSaved, isSaved, onDownload, downloads, season, setSeason, onOpen, isTV }) {
  const availableSeasons = Object.keys(seasons[item.id] || { 1: [] }).map(Number).sort((a, b) => a - b);
  const episodeList = seasons[item.id]?.[season] || [];
  const currentEpisodeId = seededProgress[item.id]?.episode;
  const similar = titles.filter((title) => title.id !== item.id && title.genres.some((genre) => item.genres.includes(genre))).slice(0, 5);
  const isDownloaded = downloads.some((download) => download.id === item.id && download.status === 'complete');
  return (
    <main className={`detail-screen ${isTV ? 'tv-detail-screen' : ''}`}>
      <section className="detail-hero">
        <img className="detail-art" src={item.backdrop || item.poster} alt="" />
        <div className="detail-art-wash" />
        <div className="detail-topline"><BackButton onClick={onBack} /><div className="detail-top-actions"><RoundButton label="Share title" onClick={() => navigator.clipboard?.writeText(item.title).catch(() => {})}><ArrowRight size={17} /></RoundButton><RoundButton label="More title information" onClick={() => document.getElementById('about-title')?.scrollIntoView({ behavior: 'smooth' })}><MoreHorizontal size={18} /></RoundButton></div></div>
        <div className="detail-hero-layout">
          <div className="detail-copy">
            <span className="detail-badge"><VeyraMark size={14} /> {item.badge || (item.type === 'series' ? 'VEYRA SERIES' : 'A GOOD STORY')}</span>
            <h1>{item.title}</h1>
            <div className="detail-meta"><span className="rating-chip"><Star size={12} fill="currentColor" /> {item.rating}</span><span>{item.year}</span><span>{item.runtime}</span><span className="meta-maturity">{item.maturity}</span></div>
            <div className="detail-genres">{item.genres.map((genre) => <span key={genre}>{genre}</span>)}</div>
            <p className="detail-description">{item.synopsis}</p>
            <div className="detail-actions">
              <ActionButton data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(item)} icon={Play}> {item.type === 'series' ? 'Continue watching' : 'Watch now'}</ActionButton>
              <button data-tv-focus={isTV ? 'true' : undefined} className={`button button-glass ${isSaved(item.id) ? 'is-saved' : ''}`} onClick={() => onToggleSaved(item)}>{isSaved(item.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved(item.id) ? 'In My List' : 'My List'}</button>
              <button className={`round-button detail-download ${isDownloaded ? 'downloaded' : ''}`} data-tv-focus={isTV ? 'true' : undefined} aria-label={isDownloaded ? 'Downloaded' : 'Download title'} onClick={() => onDownload(item)}>{isDownloaded ? <Check size={17} /> : <Download size={17} />}</button>
            </div>
            {item.type === 'series' && <div className="detail-continue-note"><span className="live-dot" /> {seededProgress[item.id]?.label || 'Season 1 · Episode 1'} <span>·</span> {seededProgress[item.id]?.remaining || 'New episodes weekly'}</div>}
          </div>
          <div className="detail-poster"><img src={item.poster} alt={`${item.title} poster`} /><span><VeyraMark size={13} /> VEYRA</span></div>
        </div>
        <div className="detail-edge-label">A STORY TO STAY WITH YOU</div>
      </section>
      <div className="detail-body page-container">
        <section id="about-title" className="about-block"><span className="eyebrow">THE STORY</span><h2>About <em>{item.title}</em></h2><p>{item.synopsis}</p><div className="credits"><span><small>DIRECTED BY</small>{item.director}</span><span><small>GENRE</small>{item.genres.join(' · ')}</span><span><small>RATING</small>{item.maturity} · Subtitles available</span></div></section>
        {item.type === 'series' && (
          <section className="episodes-section">
            <div className="rail-heading episode-heading"><div><span className="eyebrow">STAY A LITTLE LONGER</span><h2>Episodes</h2></div><label className="season-select"><span className="sr-only">Select season</span><select data-tv-focus={isTV ? 'true' : undefined} value={season} onChange={(event) => setSeason(Number(event.target.value))}>{availableSeasons.map((number) => <option key={number} value={number}>Season {number}</option>)}</select><ChevronDown size={16} /></label></div>
            <div className="episode-list">{episodeList.length ? episodeList.map((episode) => <EpisodeRow key={episode.id} episode={episode} isTV={isTV} active={episode.id === currentEpisodeId || episode.name === 'Where the Snow Ends'} onPlay={(next) => onPlay(item, next)} />) : <EmptyState icon={Film} title="The next chapter is still being made." description="New episodes will appear here as soon as they arrive." quiet />}</div>
          </section>
        )}
        <section className="cast-section"><div className="rail-heading"><div><span className="eyebrow">THE PEOPLE IN IT</span><h2>Cast & creators</h2></div><span className="cast-note">Directed by {item.director}</span></div><div className="cast-list">{item.cast.map((person, index) => <div className="cast-person" key={person}><span className={`cast-avatar cast-avatar-${index % 4}`}><span>{person.split(' ').map((part) => part[0]).join('').slice(0, 2)}</span></span><span>{person}</span><small>{index === 0 ? 'Lead' : index === 1 ? 'Cast' : 'Featuring'}</small></div>)}</div></section>
        <ContentRail title="More like this" eyebrow="KEEP THE FEELING GOING" items={similar} onItemClick={onOpen} actionLabel="" />
      </div>
    </main>
  );
}

function PlayerScreen({ title, episode, onClose, onNextEpisode, time, setTime, isPlaying, setIsPlaying, quality, setQuality, subtitles, setSubtitles, error, setError, isTV }) {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [buffering, setBuffering] = useState(false);
  const [sheet, setSheet] = useState('');
  const [audio, setAudio] = useState('Original');
  const hideTimeout = useRef(null);
  const duration = 42 * 60 + 17;
  const remaining = duration - time;
  const revealControls = useCallback(() => {
    setControlsVisible(true);
    window.clearTimeout(hideTimeout.current);
    if (isPlaying) hideTimeout.current = window.setTimeout(() => setControlsVisible(false), 3500);
  }, [isPlaying]);

  useEffect(() => {
    revealControls();
    return () => window.clearTimeout(hideTimeout.current);
  }, [revealControls]);

  useEffect(() => {
    if (!isPlaying || error) return undefined;
    const timer = window.setInterval(() => setTime((current) => {
      if (current >= duration) { setIsPlaying(false); return duration; }
      return current + 1;
    }), 1000);
    return () => window.clearInterval(timer);
  }, [isPlaying, error, setTime, setIsPlaying]);

  useEffect(() => {
    if (!buffering) return undefined;
    const timer = window.setTimeout(() => setBuffering(false), 750);
    return () => window.clearTimeout(timer);
  }, [buffering]);

  const toggle = () => {
    if (error) { setError(false); setIsPlaying(true); setBuffering(true); revealControls(); return; }
    setIsPlaying((value) => !value);
    if (!isPlaying) setBuffering(true);
    revealControls();
  };
  const seek = (delta) => { setTime((current) => Math.max(0, Math.min(duration, current + delta))); revealControls(); };
  const nearEnd = remaining <= 55 && title.type === 'series';
  const nextEpisode = (seasons[title.id]?.[2] || seasons[title.id]?.[1] || [])[4];
  const art = title.backdrop || title.poster;
  return (
    <main className={`player-screen ${isTV ? 'tv-player-screen' : ''}`} onMouseMove={revealControls} onTouchStart={revealControls} onKeyDown={revealControls}>
      <div className="player-still" style={{ backgroundImage: `url('${art}')` }} />
      <div className="player-still-wash" />
      <div className={`player-ui ${controlsVisible ? 'controls-visible' : 'controls-hidden'}`}>
        <header className="player-top"><button className="player-back" onClick={onClose} aria-label="Back to title" data-tv-focus={isTV ? 'true' : undefined}><ChevronLeft size={22} /><span>{title.title}</span></button><div className="player-top-center"><span className="player-status"><span /> PREVIEW STREAM</span>{episode && <span className="player-episode-heading">{episode.number} · {episode.name}</span>}</div><div className="player-top-actions"><RoundButton label="Subtitles" onClick={() => setSheet('subtitles')} data-tv-focus={isTV ? 'true' : undefined}><Subtitles size={18} /></RoundButton><RoundButton label="Playback settings" onClick={() => setSheet('quality')} data-tv-focus={isTV ? 'true' : undefined}><Settings size={18} /></RoundButton></div></header>
        {error ? (
          <div className="player-error"><span><CloudOff size={23} /></span><h2>Playback couldn’t start.</h2><p>We hit a small snag with this preview stream.</p><ActionButton onClick={toggle} icon={RotateCw}>Try again</ActionButton></div>
        ) : (
          <>
            {buffering && <div className="buffering-indicator"><LoaderCircle size={28} /><span>Finding your place…</span></div>}
            {nearEnd && <div className="next-episode-card"><span className="eyebrow">UP NEXT</span><span className="next-episode-number">{nextEpisode?.number || 'S02E05'}</span><h3>{nextEpisode?.name || 'A Familiar Shape'}</h3><button onClick={() => onNextEpisode(nextEpisode)}><Play size={13} fill="currentColor" /> Play next</button></div>}
            <div className="player-center-controls"><button data-tv-focus={isTV ? 'true' : undefined} onClick={() => seek(-10)} aria-label="Rewind ten seconds"><RotateCcw size={25} /><small>10</small></button><button data-tv-focus={isTV ? 'true' : undefined} className="player-main-control" onClick={toggle} aria-label={isPlaying ? 'Pause' : 'Play'}>{isPlaying ? <Pause size={27} fill="currentColor" /> : <Play size={28} fill="currentColor" />}</button><button data-tv-focus={isTV ? 'true' : undefined} onClick={() => seek(10)} aria-label="Forward ten seconds"><RotateCw size={25} /><small>10</small></button></div>
            <div className="player-footer"><div className="player-title-line"><div><span className="eyebrow">{episode ? `${episode.number} · ${title.title}` : 'NOW PLAYING'}</span><h2>{episode?.name || title.title}</h2></div><span className="preview-tag">DEMO SCREENING</span></div><input className="seek-slider" type="range" min="0" max={duration} value={time} onChange={(event) => { setTime(Number(event.target.value)); revealControls(); }} aria-label="Playback progress" data-tv-focus={isTV ? 'true' : undefined} style={{ '--range-progress': `${(time / duration) * 100}%` }} /><div className="time-row"><span>{formatTime(time)}</span><span>-{formatTime(remaining)}</span><span>{formatTime(duration)}</span></div><div className="player-tools"><button data-tv-focus={isTV ? 'true' : undefined} onClick={() => setSheet('quality')}><Settings size={16} /><span>{quality}</span></button><button data-tv-focus={isTV ? 'true' : undefined} onClick={() => setSheet('subtitles')}><Subtitles size={16} /><span>{subtitles === 'Off' ? 'Subtitles' : subtitles}</span></button><button data-tv-focus={isTV ? 'true' : undefined} onClick={() => setSheet('audio')}><AudioLines size={16} /><span>{audio}</span></button>{title.type === 'series' && <button data-tv-focus={isTV ? 'true' : undefined} onClick={() => setSheet('episodes')}><ListVideo size={16} /><span>Episodes</span></button>}</div><span className="player-mock-note">This is a frontend screening preview. Full playback connects with the VEYRA media service later.</span></div>
          </>
        )}
      </div>
      <BottomSheet title={sheet === 'quality' ? 'Video quality' : sheet === 'subtitles' ? 'Subtitles' : sheet === 'audio' ? 'Audio track' : sheet === 'episodes' ? 'Episodes' : ''} subtitle={sheet === 'quality' ? 'A better connection, a better picture.' : sheet === 'subtitles' ? 'Choose your preferred subtitles.' : sheet === 'audio' ? 'Choose an audio track.' : 'Pick up with another chapter.'} onClose={() => setSheet('')} className="player-sheet" isTV={isTV}>
        {sheet === 'quality' && <OptionList tvFocus={isTV} options={['Auto', '1080p', '720p', '480p', '360p']} selected={quality} onSelect={(value) => { setQuality(value); setSheet(''); }} />}
        {sheet === 'subtitles' && <OptionList tvFocus={isTV} options={['Off', 'English', 'Spanish', 'French', 'Arabic']} selected={subtitles} onSelect={(value) => { setSubtitles(value); setSheet(''); }} />}
        {sheet === 'audio' && <OptionList tvFocus={isTV} options={['Original', 'English audio description', 'Spanish']} selected={audio} onSelect={(value) => { setAudio(value); setSheet(''); }} />}
        {sheet === 'episodes' && <div className="sheet-episode-list">{(seasons[title.id]?.[2] || seasons[title.id]?.[1] || []).map((item) => <button data-tv-focus={isTV ? 'true' : undefined} key={item.id} className={item.id === episode?.id ? 'sheet-episode-active' : ''} onClick={() => { setSheet(''); onNextEpisode(item); }}><span>{item.number}</span><strong>{item.name}</strong><small>{item.runtime}</small>{item.id === episode?.id && <Check size={15} />}</button>)}</div>}
      </BottomSheet>
      {isTV && <div className="tv-remote-hint"><span>← BACK</span><span>OK SELECT</span><span>◁▷ SEEK</span></div>}
    </main>
  );
}

function OptionList({ options, selected, onSelect, tvFocus = false }) {
  return <div className="option-list">{options.map((option) => <button key={option} data-tv-focus={tvFocus ? 'true' : undefined} className={selected === option ? 'option-selected' : ''} onClick={() => onSelect(option)}><span className="option-check">{selected === option && <Check size={15} />}</span><span>{option}</span>{option === 'Auto' && <small>Recommended</small>}</button>)}</div>;
}

function MyListScreen({ onGo, onOpen, savedIds, onRemove }) {
  const [tab, setTab] = useState('all');
  const savedItems = getItems(savedIds).filter((item) => tab === 'all' || item.type === tab);
  return (
    <main className="page-screen">
      <TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} />
      <div className="page-container library-page"><PageTitle eyebrow="YOUR PRIVATE SHELF" title="My List" description="The stories you want to keep close." right={<span className="library-count">{savedItems.length} saved</span>} />
        <div className="library-tabs" role="tablist"><button className={tab === 'all' ? 'selected' : ''} onClick={() => setTab('all')}>Everything <span>{getItems(savedIds).length}</span></button><button className={tab === 'movie' ? 'selected' : ''} onClick={() => setTab('movie')}>Movies <span>{getItems(savedIds).filter((item) => item.type === 'movie').length}</span></button><button className={tab === 'series' ? 'selected' : ''} onClick={() => setTab('series')}>Series <span>{getItems(savedIds).filter((item) => item.type === 'series').length}</span></button></div>
        {savedItems.length ? <div className="poster-grid library-grid">{savedItems.map((item) => <PosterCard key={item.id} item={item} onClick={onOpen} onRemove={onRemove} />)}</div> : <EmptyState icon={Heart} title="Nothing here yet." description="Save something you want to watch later. Your next favourite is out there." actionLabel="Explore stories" onAction={() => onGo('discover')} />}
      </div>
    </main>
  );
}

function ContinueScreen({ onGo, onOpen, onPlay }) {
  const [items, setItems] = useState(railData.continue.filter((id) => seededProgress[id]).map((id) => ({ item: titleById[id], progress: seededProgress[id] })));
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container continue-page"><PageTitle eyebrow="PICK UP WHERE YOU LEFT OFF" title="Keep watching." description="Your next chapter is right where you left it." />
      {items.length ? <div className="continue-list">{items.map(({ item, progress }) => <article className="continue-card" key={item.id}><button className="continue-art" onClick={() => onPlay(item)}><img src={item.poster} alt="" /><span><Play size={18} fill="currentColor" /></span><ProgressBar value={progress.percent} /></button><div className="continue-info"><span className="eyebrow">{item.type === 'series' ? progress.label : 'FEATURE FILM'}</span><h2>{item.title}</h2><p>{progress.remaining} <span>·</span> {progress.percent}% watched</p><div className="continue-actions"><ActionButton onClick={() => onPlay(item)} icon={Play}>Resume</ActionButton><button className="text-button" onClick={() => onOpen(item)}>View details <ArrowRight size={15} /></button></div></div><button className="continue-remove" onClick={() => setItems((current) => current.filter((entry) => entry.item.id !== item.id))} aria-label={`Remove ${item.title} from Continue Watching`}><X size={16} /></button></article>)}</div> : <EmptyState icon={Clock3} title="You’re all caught up." description="When you start watching something, we’ll keep your place right here." actionLabel="Find something to watch" onAction={() => onGo('discover')} />}
    </div></main>
  );
}

function HistoryScreen({ onGo, onOpen, onResume, entries, onClear, onRemove }) {
  const [askClear, setAskClear] = useState(false);
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container history-page"><PageTitle eyebrow="YOUR RECENT SCREENINGS" title="Watch history" description="A little record of where you’ve been." right={entries.length > 0 && <button className="subtle-action" onClick={() => setAskClear(true)}><Trash2 size={15} /> Clear history</button>} />
      {entries.length ? <div className="history-list">{entries.map((entry) => { const item = titleById[entry.id]; if (!item) return null; return <article className="history-row" key={`${entry.id}-${entry.date}`}><button className="history-art" onClick={() => onOpen(item)}><img src={item.poster} alt="" /><ProgressBar value={entry.percent} /></button><button className="history-info" onClick={() => onOpen(item)}><span className="eyebrow">{entry.date}</span><h2>{item.title}</h2><span>{entry.detail} <i>·</i> {entry.percent}% watched</span><small>{entry.percent >= 95 ? 'Finished' : `${item.duration - Math.round(item.duration * entry.percent / 100)} min left`}</small></button><button className="history-resume" onClick={() => onResume(item, entry)}><Play size={15} fill="currentColor" /><span>Resume</span></button><button className="history-more" aria-label={`Remove ${item.title} from history`} onClick={() => onRemove(entry)}><X size={16} /></button></article>; })}</div> : <EmptyState icon={History} title="Your story starts here." description="Anything you watch will find its way into your history." actionLabel="Browse VEYRA" onAction={() => onGo('discover')} />}
      </div>
      {askClear && <ConfirmDialog title="Clear your watch history?" description="This will remove your recent screenings from this device. Your saved list won’t change." confirmLabel="Clear history" onCancel={() => setAskClear(false)} onConfirm={() => { onClear(); setAskClear(false); }} />}
    </main>
  );
}

function ConfirmDialog({ title, description, confirmLabel, onConfirm, onCancel }) {
  return <div className="dialog-backdrop" role="presentation" onClick={onCancel}><section className="confirm-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}><span className="dialog-icon"><Trash2 size={19} /></span><h2>{title}</h2><p>{description}</p><div><button className="button button-outline" onClick={onCancel}>Cancel</button><button className="button button-danger" onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}

function DownloadsScreen({ onGo, downloads, setDownloads, onOpen, onPlay }) {
  const usedGB = downloads.reduce((sum, entry) => sum + (entry.status === 'complete' ? parseFloat(entry.size) || 0 : (parseFloat(entry.size) || 0) * (entry.progress / 100)), 0);
  useEffect(() => {
    if (!downloads.some((entry) => entry.status === 'downloading' && !entry.paused)) return undefined;
    const timer = window.setInterval(() => setDownloads((current) => current.map((entry) => entry.status === 'downloading' && !entry.paused ? { ...entry, progress: Math.min(100, entry.progress + 1), status: entry.progress >= 99 ? 'complete' : entry.status } : entry)));
    return () => window.clearInterval(timer);
  }, [downloads, setDownloads]);
  const update = (id, patch) => setDownloads((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
  const remove = (id) => setDownloads((current) => current.filter((entry) => entry.id !== id));
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container downloads-page"><PageTitle eyebrow="TAKE THE CINEMA WITH YOU" title="Downloads" description="Ready when the signal isn’t." right={<span className="download-mode-pill"><Wifi size={14} /> On this device</span>} />
      <div className="storage-card"><div className="storage-icon"><HardDrive size={19} /></div><div className="storage-copy"><span className="eyebrow">DEVICE STORAGE</span><strong>{usedGB.toFixed(1)} GB <small>of 32 GB used by VEYRA</small></strong><div className="storage-track"><span style={{ width: `${Math.min(100, usedGB / 32 * 100)}%` }} /></div></div><button aria-label="Storage settings" onClick={() => onGo('settings')}><ChevronRight size={18} /></button></div>
      {downloads.length ? <><SectionLabel>YOUR LIBRARY <span className="section-count">{downloads.length} titles</span></SectionLabel><div className="download-list">{downloads.map((entry) => { const item = titleById[entry.id]; if (!item) return null; return <article className="download-card" key={entry.id}><button className="download-art" onClick={() => onOpen(item)}><img src={item.poster} alt="" />{entry.status === 'complete' && <span className="download-complete"><Check size={13} /></span>}</button><div className="download-info"><div className="download-title-line"><div><h2>{item.title}</h2><span>{entry.quality} · {entry.size}</span></div><button className="download-more" onClick={() => remove(entry.id)} aria-label={`Delete ${item.title} download`}><Trash2 size={15} /></button></div>{entry.status === 'downloading' ? <><div className="download-progress-line"><ProgressBar value={entry.progress} /><span>{entry.progress}%</span></div><small>{entry.paused ? 'Paused' : 'Downloading'} <i>·</i> {entry.progress >= 100 ? 'Ready offline' : 'Available offline when complete'}</small><div className="download-actions"><button onClick={() => update(entry.id, { paused: !entry.paused })}>{entry.paused ? <Play size={13} fill="currentColor" /> : <Pause size={13} />}{entry.paused ? 'Resume' : 'Pause'}</button><button onClick={() => remove(entry.id)}><X size={13} /> Cancel</button></div></> : <><div className="download-ready"><CheckCircle2 size={14} /><span>Downloaded · Ready offline</span><span>{entry.quality}</span></div><button className="download-play" onClick={() => onPlay(item)}><Play size={13} fill="currentColor" /> Play offline</button></>}</div></article>; })}</div></> : <EmptyState icon={Download} title="Your offline shelf is empty." description="Download a movie or episode and it’ll be ready, even without a signal." actionLabel="Explore stories" onAction={() => onGo('discover')} />}
      <div className="download-note"><WifiOff size={16} /><span>Downloads are saved on this device and available without an internet connection.</span><button onClick={() => onGo('offline')}>Learn more</button></div>
      </div></main>
  );
}

const initialDevices = [
  { id: 'phone', name: 'This phone', detail: 'Android · This device', icon: Smartphone, active: true, location: 'Last active just now' },
  { id: 'living-room', name: 'Living Room TV', detail: 'Android TV · Living room', icon: Tv, active: false, location: 'Last active yesterday' },
  { id: 'chrome', name: 'Chrome', detail: 'Web · MacBook Pro', icon: Monitor, active: false, location: 'Last active Oct 4' },
];

function ProfileScreen({ onGo, user, onSignOut, setOffline, isOffline }) {
  const profileLinks = [
    { title: 'Continue watching', detail: 'Pick up where you left off', icon: Play, route: 'continue' },
    { title: 'Watch history', detail: 'Your recent screenings', icon: History, route: 'history' },
    { title: 'My List', detail: 'Stories you’ve saved', icon: Heart, route: 'list' },
    { title: 'Downloads', detail: 'Ready for offline', icon: Download, route: 'downloads' },
  ];
  const settingsLinks = [
    { title: 'Playback', detail: 'Video, subtitles & autoplay', icon: Settings, route: 'settings' },
    { title: 'Devices', detail: 'Manage where you watch', icon: MonitorPlay, route: 'devices' },
    { title: 'Notifications', detail: 'New episodes & releases', icon: Bell, route: 'notifications' },
    { title: 'Account & privacy', detail: 'Your details and preferences', icon: ShieldCheck, route: 'settings' },
    { title: 'About VEYRA', detail: 'Version 1.0.0 · Made for stories', icon: CircleHelp, route: 'settings' },
  ];
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container profile-page"><PageTitle eyebrow="YOUR VEYRA" title="A little more you." description="Your space, your pace, your next story." />
      <section className="profile-card"><div className="profile-avatar">{user?.name?.slice(0, 1)?.toUpperCase() || 'A'}<span /></div><div className="profile-identity"><span className="eyebrow">THE CINEMA IS YOURS</span><h2>{user?.name || 'Alex Morgan'}</h2><p>{user?.email || 'alex@example.com'}</p></div><button className="profile-edit" onClick={() => onGo('settings')}>Edit profile <ChevronRight size={15} /></button><div className="profile-plan"><VeyraMark size={18} /><span>VEYRA<small>MEMBER</small></span><i /> <strong>All stories included</strong></div></section>
      <div className="profile-columns"><section><SectionLabel>YOUR LIBRARY</SectionLabel><div className="profile-link-list">{profileLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section><section><SectionLabel>PREFERENCES & ACCOUNT</SectionLabel><div className="profile-link-list">{settingsLinks.map(({ title, detail, icon: Icon, route }) => <button className="profile-link-row" key={title} onClick={() => onGo(route)}><span className="profile-link-icon"><Icon size={17} /></span><span><strong>{title}</strong><small>{detail}</small></span><ChevronRight size={16} /></button>)}</div></section></div>
      <div className="profile-quick-actions"><button onClick={() => onGo('tv-home')}><Tv size={17} /><span><strong>Open TV experience</strong><small>Explore VEYRA on the big screen</small></span><ChevronRight size={16} /></button><button className={isOffline ? 'offline-active' : ''} onClick={() => { setOffline(!isOffline); onGo(!isOffline ? 'offline' : 'home'); }}><WifiOff size={17} /><span><strong>{isOffline ? 'Return online' : 'Preview offline mode'}</strong><small>{isOffline ? 'Local sample data is being used' : 'See the downloads-first experience'}</small></span><ChevronRight size={16} /></button></div>
      <div className="signout-row"><span>Signed in as {user?.email || 'guest@veyra.local'}</span><button onClick={onSignOut}><LogOut size={15} /> Sign out</button></div>
    </div></main>
  );
}

function SettingsScreen({ onGo, settings, setSettings, onPreviewLoading, onPreviewError }) {
  const update = (key, value) => setSettings((current) => ({ ...current, [key]: value }));
  const rows = [
    { title: 'Video quality', detail: 'Choose what works for your connection', key: 'quality', options: ['Auto', '1080p', '720p', '480p'] },
    { title: 'Subtitles', detail: 'Your preferred subtitle language', key: 'subtitles', options: ['English', 'Off', 'Spanish', 'French', 'Arabic'] },
    { title: 'Language', detail: 'App language', key: 'language', options: ['English', 'Español', 'Français', 'العربية'] },
    { title: 'Appearance', detail: 'Keep the cinema dark', key: 'appearance', options: ['Dark', 'System'] },
  ];
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container settings-page"><button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Profile</button><PageTitle eyebrow="MAKE IT YOURS" title="Settings" description="A few small things that make it feel like your cinema." />
      <section className="settings-group"><SectionLabel>PLAYBACK</SectionLabel>{rows.slice(0, 2).map((row) => <div className="settings-row" key={row.key}><span className="setting-symbol">{row.key === 'quality' ? <Activity size={17} /> : <Subtitles size={17} />}</span><span className="setting-copy"><strong>{row.title}</strong><small>{row.detail}</small></span><label className="setting-select"><select aria-label={row.title} value={settings[row.key]} onChange={(event) => update(row.key, event.target.value)}>{row.options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label></div>)}
        <div className="settings-row"><span className="setting-symbol"><Play size={17} /></span><span className="setting-copy"><strong>Autoplay next episode</strong><small>Keep the story going after the credits</small></span><Toggle value={settings.autoplay} onChange={(value) => update('autoplay', value)} label="Autoplay next episode" /></div>
        <div className="settings-row"><span className="setting-symbol"><Wifi size={17} /></span><span className="setting-copy"><strong>Use mobile data</strong><small>Stream when Wi-Fi isn’t available</small></span><Toggle value={settings.mobileData} onChange={(value) => update('mobileData', value)} label="Use mobile data" /></div>
      </section>
      <section className="settings-group"><SectionLabel>APP & NOTIFICATIONS</SectionLabel>{rows.slice(2).map((row) => <div className="settings-row" key={row.key}><span className="setting-symbol">{row.key === 'language' ? <Languages size={17} /> : <Moon size={17} />}</span><span className="setting-copy"><strong>{row.title}</strong><small>{row.detail}</small></span><label className="setting-select"><select aria-label={row.title} value={settings[row.key]} onChange={(event) => update(row.key, event.target.value)}>{row.options.map((option) => <option key={option}>{option}</option>)}</select><ChevronDown size={14} /></label></div>)}
        <div className="settings-row"><span className="setting-symbol"><Bell size={17} /></span><span className="setting-copy"><strong>Notifications</strong><small>New episodes and thoughtful picks</small></span><Toggle value={settings.notifications} onChange={(value) => update('notifications', value)} label="Notifications" /></div>
      </section>
      <section className="settings-group"><SectionLabel>ACCOUNT & PRIVACY</SectionLabel><button className="settings-link-row" onClick={() => onGo('devices')}><span className="setting-symbol"><MonitorPlay size={17} /></span><span className="setting-copy"><strong>Manage devices</strong><small>See where VEYRA is signed in</small></span><ChevronRight size={17} /></button><button className="settings-link-row" onClick={() => onGo('downloads')}><span className="setting-symbol"><HardDrive size={17} /></span><span className="setting-copy"><strong>Storage & downloads</strong><small>Review saved titles on this device</small></span><ChevronRight size={17} /></button><button className="settings-link-row" onClick={() => onGo('offline')}><span className="setting-symbol"><ShieldCheck size={17} /></span><span className="setting-copy"><strong>Privacy & data</strong><small>Your preferences stay on this device</small></span><ChevronRight size={17} /></button></section>
      <section className="settings-preview"><div><span className="eyebrow">FRONTEND PREVIEW</span><h2>Try the little details.</h2><p>These demos help you walk through the quiet states too.</p></div><div><button onClick={onPreviewLoading}><LoaderCircle size={15} /> Loading state</button><button onClick={onPreviewError}><CloudOff size={15} /> Error state</button></div></section>
      <p className="settings-disclaimer">These preferences are saved on this device. Account and playback services are mock experiences until backend integration.</p>
    </div></main>
  );
}

function DevicesScreen({ onGo, devices, setDevices, notify }) {
  const removeDevice = (device) => { setDevices((current) => current.filter((entry) => entry.id !== device.id)); notify(`${device.name} signed out.`); };
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container devices-page"><button className="inline-back" onClick={() => onGo('profile')}><ChevronLeft size={16} /> Profile</button><PageTitle eyebrow="YOUR CONNECTED CINEMAS" title="Devices" description="The places your VEYRA lives." />
      {devices.length ? <div className="device-list">{devices.map(({ id, name, detail, icon: Icon, active, location }) => <article className={`device-card ${active ? 'device-current' : ''}`} key={id}><span className="device-icon"><Icon size={21} /></span><div className="device-copy"><h2>{name} {active && <span>THIS DEVICE</span>}</h2><p>{detail}</p><small>{location}</small></div><button className="device-remove" onClick={() => removeDevice({ id, name })}>{active ? 'Sign out' : 'Remove'} <ChevronRight size={15} /></button></article>)}</div> : <EmptyState icon={MonitorPlay} title="A little quieter, everywhere." description="There are no other devices connected to your account." actionLabel="Back to profile" onAction={() => onGo('profile')} />}
      <div className="device-footnote"><ShieldCheck size={16} /><span>Only devices you recognize should have access. Sign out of anything that doesn’t feel like yours.</span></div>
    </div></main>
  );
}

function NotificationsScreen({ onGo, notifications, setNotifications, onOpen }) {
  const unread = notifications.filter((entry) => entry.unread).length;
  const remove = (id) => setNotifications((current) => current.filter((entry) => entry.id !== id));
  return (
    <main className="page-screen"><TopBar onGo={onGo} onSearch={() => onGo('search')} onNotifications={() => onGo('notifications')} onProfile={() => onGo('profile')} /><div className="page-container notifications-page"><PageTitle eyebrow="A STORY WORTH A TAP" title="Notifications" description="Only the things you’ll be glad you heard about." right={unread > 0 && <button className="subtle-action" onClick={() => setNotifications((current) => current.map((entry) => ({ ...entry, unread: false })))}><Check size={15} /> Mark all read</button>} />
      {notifications.length ? <div className="notification-list">{notifications.map((entry) => <article className={`notification-card ${entry.unread ? 'is-unread' : ''}`} key={entry.id}><button className="notification-main" onClick={() => { setNotifications((current) => current.map((item) => item.id === entry.id ? { ...item, unread: false } : item)); const item = titleById[entry.contentId]; if (item) onOpen(item); }}><img src={entry.poster} alt="" /><span className="notification-copy"><span className="notification-kind">{entry.kind === 'episode' ? 'NEW EPISODE' : entry.kind === 'release' ? 'NEW RELEASE' : 'A PICK FOR YOU'} {entry.unread && <i />}</span><strong>{entry.title}</strong><span>{entry.body}</span><small>{entry.time}</small></span><ChevronRight size={17} /></button><button className="notification-remove" aria-label="Dismiss notification" onClick={() => remove(entry.id)}><X size={15} /></button></article>)}</div> : <EmptyState icon={Bell} title="Nothing to interrupt your evening." description="When there’s something new, we’ll let you know — gently." actionLabel="Find a story" onAction={() => onGo('discover')} />}
    </div></main>
  );
}

function OfflineScreen({ onGo, onTryAgain, downloads }) {
  const ready = downloads.filter((entry) => entry.status === 'complete');
  return (
    <main className="offline-screen"><div className="offline-top"><Brand onClick={() => onGo('home')} /><span className="offline-mode"><span /> OFFLINE MODE</span></div><div className="offline-orbit" /><div className="offline-content"><span className="offline-icon"><WifiOff size={24} /></span><span className="eyebrow">A SMALL PAUSE</span><h1>You’re<br /><em>offline.</em></h1><p>Your downloaded movies are still available. The rest of VEYRA will be right here when you’re back.</p><ActionButton onClick={() => onGo('downloads')} icon={Download}>View downloads</ActionButton><button className="offline-retry" onClick={onTryAgain}><Wifi size={15} /> Try reconnecting</button></div><div className="offline-bottom"><span>{ready.length} downloaded {ready.length === 1 ? 'title' : 'titles'} ready on this device</span><button onClick={() => onGo('profile')}>Profile <ArrowRight size={14} /></button></div></main>
  );
}

function LoadingDemo({ onBack }) {
  return <main className="page-screen"><div className="page-container state-demo-page"><button className="inline-back" onClick={onBack}><ChevronLeft size={16} /> Settings</button><PageTitle eyebrow="A MOMENT, PLEASE" title="Finding your next story." description="A good screen should feel considered, even while it’s getting ready." /><div className="skeleton-hero"><span className="skeleton" /><span className="skeleton-copy"><i className="skeleton" /><i className="skeleton short" /><i className="skeleton button-skeleton" /></span></div><SectionLabel>YOUR EVENING, LOADING</SectionLabel><SkeletonRows count={5} /><div className="demo-state-caption"><LoaderCircle size={15} /> Skeletons keep the page calm while something loads.</div></div></main>;
}

function TVHomeScreen({ onGo, onOpen, onPlay, onSearch, onProfile, savedIds }) {
  const featured = titleById['last-signal'];
  return (
    <main className="tv-home-screen">
      <aside className="tv-sidebar"><Brand onClick={() => onGo('tv-home')} data-tv-focus="true" /><nav><button className="tv-nav-active" data-tv-focus="true" onClick={() => onGo('tv-home')}><span><Play size={18} /></span>Home</button><button data-tv-focus="true" onClick={onSearch}><span><Search size={18} /></span>Search</button><button data-tv-focus="true" onClick={() => onGo('list')}><span><Heart size={18} /></span>My List</button><button data-tv-focus="true" onClick={onProfile}><span><UserRound size={18} /></span>Profile</button></nav><div className="tv-sidebar-bottom"><span className="tv-avatar">A</span><span>Alex Morgan</span><button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ArrowRight size={14} /></button></div></aside>
      <div className="tv-main"><div className="tv-topline"><span className="tv-now"><span /> YOUR EVENING, CURATED</span><div><span className="tv-clock">8:42</span><button data-tv-focus="true" onClick={onProfile}><Bell size={17} /><i /></button></div></div>
        <section className="tv-feature" style={{ '--feature-art': `url('${featured.backdrop}')` }}><div className="tv-feature-wash" /><div className="tv-feature-copy"><span className="eyebrow"><VeyraMark size={14} /> VEYRA ORIGINAL · NEW FILM</span><h1>The Last<br /><em>Signal.</em></h1><p>Somewhere in the static, someone is trying to reach us.</p><div className="tv-meta"><span><Star size={13} fill="currentColor" /> 8.6</span><span>2026</span><span>2h 08m</span><span>Sci-Fi · Mystery</span></div><div className="tv-feature-actions"><button className="button button-primary" data-tv-focus="true" onClick={() => onPlay(featured)}><Play size={16} fill="currentColor" /> Watch now</button><button className="button button-glass" data-tv-focus="true" onClick={() => onOpen(featured)}>Explore title <ArrowRight size={15} /></button></div></div><span className="tv-feature-aside">A STORY FOR TONIGHT <i>01 / 04</i></span></section>
        <section className="tv-rails"><ContentRail title="Continue watching" eyebrow="RIGHT WHERE YOU LEFT OFF" items={getItems(railData.continue)} onItemClick={onOpen} progressFor={(id) => seededProgress[id]?.percent} tvFocus compact actionLabel="" /><ContentRail title="Trending now" items={getItems(railData.trending)} onItemClick={onOpen} tvFocus compact actionLabel="" /><ContentRail title="Series worth staying up for" items={getItems(railData.popularSeries)} onItemClick={onOpen} tvFocus compact actionLabel="" /></section>
      </div><div className="tv-remote-hint tv-home-hint"><span>↑↓ MOVE</span><span>OK SELECT</span><span>BACK RETURN</span></div>
    </main>
  );
}

function TVProfile({ onGo }) {
  return <div className="tv-profile-popover"><div className="tv-avatar">A</div><strong>Alex Morgan</strong><button data-tv-focus="true" onClick={() => onGo('profile')}>Account & settings <ChevronRight size={14} /></button><button data-tv-focus="true" onClick={() => onGo('devices')}>Manage devices <ChevronRight size={14} /></button><button data-tv-focus="true" onClick={() => onGo('home')}>Exit TV mode <ArrowRight size={14} /></button></div>;
}

export default function App() {
  const [view, setView] = useState(() => initialRoute());
  const [showSplash, setShowSplash] = useState(true);
  const [selectedTitle, setSelectedTitle] = useState(titleById['last-signal']);
  const [detailFrom, setDetailFrom] = useState('home');
  const [playerFrom, setPlayerFrom] = useState('home');
  const [playingTitle, setPlayingTitle] = useState(titleById['last-signal']);
  const [playingEpisode, setPlayingEpisode] = useState(null);
  const [playerTime, setPlayerTime] = useState(18 * 60 + 42);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playerError, setPlayerError] = useState(false);
  const [quality, setQuality] = useState('Auto');
  const [subtitles, setSubtitles] = useState('English');
  const [season, setSeason] = useState(2);
  const [savedIds, setSavedIds] = useState(() => readStore('veyra-list', ['saltline', 'northbound']));
  const [downloads, setDownloads] = useState(() => readStore('veyra-downloads', initialDownloads));
  const [history, setHistory] = useState(() => readStore('veyra-history', initialHistory));
  const [notifications, setNotifications] = useState(() => readStore('veyra-notifications', initialNotifications));
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...readStore('veyra-settings', {}) }));
  const [user, setUser] = useState(() => readStore('veyra-user', { name: 'Alex Morgan', email: 'alex@example.com' }));
  const [devices, setDevices] = useState(initialDevices);
  const [selectedType, setSelectedType] = useState('all');
  const [toast, setToast] = useState('');
  const [isOffline, setIsOffline] = useState(() => typeof navigator !== 'undefined' ? !navigator.onLine : false);
  const toastTimer = useRef(null);
  const [tvProfileOpen, setTvProfileOpen] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowSplash(false), 1100);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { localStorage.setItem('veyra-list', JSON.stringify(savedIds)); }, [savedIds]);
  useEffect(() => { localStorage.setItem('veyra-downloads', JSON.stringify(downloads)); }, [downloads]);
  useEffect(() => { localStorage.setItem('veyra-history', JSON.stringify(history)); }, [history]);
  useEffect(() => { localStorage.setItem('veyra-notifications', JSON.stringify(notifications)); }, [notifications]);
  useEffect(() => { localStorage.setItem('veyra-settings', JSON.stringify(settings)); }, [settings]);
  useEffect(() => { setQuality(settings.quality || 'Auto'); }, [settings.quality]);
  useEffect(() => { setSubtitles(settings.subtitles || 'English'); }, [settings.subtitles]);
  useEffect(() => { localStorage.setItem('veyra-user', JSON.stringify(user)); }, [user]);
  useEffect(() => {
    const onOffline = () => { setIsOffline(true); setView('offline'); };
    const onOnline = () => { setIsOffline(false); };
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
    toastTimer.current = window.setTimeout(() => setToast(''), 2600);
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
    setSeason(item.id === 'northbound' ? 2 : 1);
    setView(from.startsWith('tv') ? 'tv-detail' : 'detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const goBackFromDetail = () => go(detailFrom || 'home');
  const startPlayer = (item = selectedTitle, episode = null) => {
    setPlayingTitle(item || titleById['last-signal']);
    setPlayingEpisode(episode);
    setPlayerTime(item?.id === 'northbound' ? 18 * 60 + 42 : Math.round(42 * 60 * ((seededProgress[item?.id]?.percent || 38) / 100)));
    setPlayerError(false);
    setIsPlaying(false);
    setPlayerFrom(view);
    setView(view.startsWith('tv') ? 'tv-player' : 'player');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  const closePlayer = () => {
    setIsPlaying(false);
    const percent = Math.min(99, Math.max(1, Math.round((playerTime / (42 * 60 + 17)) * 100)));
    const episodeLabel = playingEpisode ? `${playingEpisode.number} · ${playingEpisode.name}` : (playingTitle.type === 'series' ? 'Series' : 'Movie');
    setHistory((current) => [{ id: playingTitle.id, date: 'Today · just now', detail: episodeLabel, percent, episode: playingEpisode?.id }, ...current.filter((entry) => entry.id !== playingTitle.id)].slice(0, 12));
    setView(playerFrom || 'home');
  };
  const toggleSaved = (item) => {
    const has = savedIds.includes(item.id);
    setSavedIds((current) => has ? current.filter((id) => id !== item.id) : [item.id, ...current]);
    notify(has ? `${item.title} removed from My List` : `${item.title} added to My List`);
  };
  const isSaved = (id) => savedIds.includes(id);
  const downloadTitle = (item) => {
    if (downloads.some((entry) => entry.id === item.id)) { go('downloads'); notify('Already in your downloads.'); return; }
    setDownloads((current) => [{ id: item.id, quality: settings.quality === 'Auto' ? '1080p' : settings.quality, progress: 0, status: 'downloading', paused: false, size: item.type === 'series' ? '1.2 GB' : '2.1 GB' }, ...current]);
    notify(`${item.title} added to downloads`);
  };
  const resumeTitle = (item, entry) => {
    const episode = entry?.episode ? Object.values(seasons[item.id] || {}).flat().find((part) => part.id === entry.episode || part.name === entry.detail?.split(' · ')[1]) : null;
    startPlayer(item, episode);
  };
  const finishAuth = (account) => { setUser(account); go('home'); notify(`Welcome${account.name ? `, ${account.name.split(' ')[0]}` : ''}.`); };
  const unreadCount = notifications.filter((entry) => entry.unread).length;

  useEffect(() => {
    if (!view.startsWith('tv')) return undefined;
    const focusTimer = window.setTimeout(() => {
      const selector = view === 'tv-home' ? '.tv-feature-actions [data-tv-focus="true"]' : view === 'tv-player' ? '.player-main-control[data-tv-focus="true"]' : view === 'tv-detail' ? '.detail-actions [data-tv-focus="true"]' : '[data-tv-focus="true"]';
      document.querySelector(selector)?.focus({ preventScroll: true });
    }, 90);
    const handleRemote = (event) => {
      if (view === 'tv-player' && [' ', 'MediaPlayPause'].includes(event.key)) {
        event.preventDefault();
        document.querySelector('.tv-player-screen .player-main-control')?.click();
        return;
      }
      if (view === 'tv-player' && ['ArrowLeft', 'ArrowRight'].includes(event.key) && document.activeElement?.matches('.seek-slider')) {
        event.preventDefault();
        setPlayerTime((time) => Math.max(0, Math.min(42 * 60 + 17, time + (event.key === 'ArrowLeft' ? -10 : 10))));
        return;
      }
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
        if (view === 'tv-player') closePlayer();
        else if (view === 'tv-detail') goBackFromDetail();
        else if (view === 'tv-home') go('home');
      }
    };
    document.addEventListener('keydown', handleRemote);
    return () => { window.clearTimeout(focusTimer); document.removeEventListener('keydown', handleRemote); };
  }, [view, detailFrom, playerFrom]);

  const playerProps = {
    title: playingTitle,
    episode: playingEpisode,
    onClose: closePlayer,
    onNextEpisode: (episode) => { if (episode) setPlayingEpisode(episode); setPlayerTime(0); setIsPlaying(true); setPlayerError(false); },
    time: playerTime,
    setTime: setPlayerTime,
    isPlaying,
    setIsPlaying,
    quality,
    setQuality: (value) => { setQuality(value); setSettings((current) => ({ ...current, quality: value })); },
    subtitles,
    setSubtitles: (value) => { setSubtitles(value); setSettings((current) => ({ ...current, subtitles: value })); },
    error: playerError,
    setError: setPlayerError,
    isTV: view === 'tv-player',
  };

  let screen;
  if (['welcome', 'signin', 'signup', 'forgot'].includes(view)) {
    screen = <AuthScreen mode={view} onMode={go} onDone={finishAuth} onBack={() => go('home')} />;
  } else if (view === 'home') {
    screen = <HomeScreen onGo={go} onSearch={onSearch} onNotifications={() => go('notifications')} onProfile={() => go('profile')} onOpen={onOpenTitle} onPlay={startPlayer} isSaved={isSaved} onToggleSaved={toggleSaved} />;
  } else if (view === 'discover') {
    screen = <DiscoverScreen onGo={go} onOpen={onOpenTitle} selectedType={selectedType} setSelectedType={setSelectedType} />;
  } else if (view === 'search') {
    screen = <SearchScreen onGo={go} onOpen={onOpenTitle} />;
  } else if (view === 'detail' || view === 'tv-detail') {
    screen = <DetailScreen item={selectedTitle} onBack={goBackFromDetail} onPlay={(item, episode) => startPlayer(item, episode)} onToggleSaved={toggleSaved} isSaved={isSaved} onDownload={downloadTitle} downloads={downloads} season={season} setSeason={setSeason} onOpen={onOpenTitle} isTV={view === 'tv-detail'} />;
  } else if (view === 'player' || view === 'tv-player' || view === 'player-error-demo') {
    screen = <PlayerScreen key={`${playingTitle.id}-${view}`} {...playerProps} />;
  } else if (view === 'list') {
    screen = <MyListScreen onGo={go} onOpen={onOpenTitle} savedIds={savedIds} onRemove={(item) => { setSavedIds((current) => current.filter((id) => id !== item.id)); notify(`${item.title} removed from My List`); }} />;
  } else if (view === 'continue') {
    screen = <ContinueScreen onGo={go} onOpen={onOpenTitle} onPlay={startPlayer} />;
  } else if (view === 'history') {
    screen = <HistoryScreen onGo={go} onOpen={onOpenTitle} onResume={resumeTitle} entries={history} onClear={() => { setHistory([]); notify('Watch history cleared.'); }} onRemove={(entry) => setHistory((current) => current.filter((item) => item !== entry))} />;
  } else if (view === 'downloads') {
    screen = <DownloadsScreen onGo={go} downloads={downloads} setDownloads={setDownloads} onOpen={onOpenTitle} onPlay={startPlayer} />;
  } else if (view === 'profile') {
    screen = <ProfileScreen onGo={go} user={user} onSignOut={() => { setUser({ name: 'Guest', email: 'guest@veyra.local' }); go('welcome'); notify('You’ve signed out.'); }} setOffline={setIsOffline} isOffline={isOffline} />;
  } else if (view === 'settings') {
    screen = <SettingsScreen onGo={go} settings={settings} setSettings={setSettings} onPreviewLoading={() => go('loading-demo')} onPreviewError={() => { setPlayingTitle(titleById['last-signal']); setPlayingEpisode(null); setPlayerFrom('settings'); setPlayerError(true); setView('player-error-demo'); }} />;
  } else if (view === 'devices') {
    screen = <DevicesScreen onGo={go} devices={devices} setDevices={setDevices} notify={notify} />;
  } else if (view === 'notifications') {
    screen = <NotificationsScreen onGo={go} notifications={notifications} setNotifications={setNotifications} onOpen={onOpenTitle} />;
  } else if (view === 'offline') {
    screen = <OfflineScreen onGo={go} onTryAgain={() => { setIsOffline(false); go('home'); notify('You’re back online.'); }} downloads={downloads} />;
  } else if (view === 'loading-demo') {
    screen = <LoadingDemo onBack={() => go('settings')} />;
  } else if (view === 'error-demo') {
    screen = <main className="page-screen"><div className="page-container state-demo-page"><button className="inline-back" onClick={() => go('settings')}><ChevronLeft size={16} /> Settings</button><PageTitle eyebrow="A SMALL SETBACK" title="An error state can still feel human." description="A clear next step is better than a dead end." /><ErrorState title="Something went wrong." description="We couldn’t load your stories just now. Your saved titles are safe." onRetry={() => { go('home'); notify('Your stories are ready.'); }} /></div></main>;
  } else if (view === 'tv-home') {
    screen = <TVHomeScreen onGo={go} onOpen={onOpenTitle} onPlay={startPlayer} onSearch={onSearch} onProfile={() => setTvProfileOpen((value) => !value)} savedIds={savedIds} />;
  } else {
    screen = <HomeScreen onGo={go} onSearch={onSearch} onNotifications={() => go('notifications')} onProfile={() => go('profile')} onOpen={onOpenTitle} onPlay={startPlayer} isSaved={isSaved} onToggleSaved={toggleSaved} />;
  }

  const showBottomNav = ['home', 'discover', 'search', 'list', 'profile', 'continue', 'history', 'downloads', 'settings', 'devices', 'notifications'].includes(view);
  const navActive = ['home', 'discover'].includes(view) ? 'home' : view === 'search' ? 'search' : view === 'list' ? 'list' : ['profile', 'continue', 'history', 'downloads', 'settings', 'devices', 'notifications'].includes(view) ? 'profile' : '';
  return (
    <div className={`app-shell ${view.startsWith('tv') ? 'app-tv-mode' : ''}`}>
      {screen}
      {showBottomNav && <BottomNav active={navActive} onGo={(destination) => go(destination)} />}
      {view === 'tv-home' && tvProfileOpen && <TVProfile onGo={go} />}
      {isOffline && !['offline', 'welcome', 'signin', 'signup', 'forgot'].includes(view) && <button className="offline-indicator" onClick={() => go('offline')}><WifiOff size={13} /> Offline</button>}
      <Toast message={toast} onClose={dismissToast} />
      {showSplash && <div className="splash-screen"><VeyraMark size={46} /><span>VEYRA</span><small>WATCH WHAT MOVES YOU</small><i /></div>}
      <span className="sr-only" aria-live="polite">{unreadCount ? `${unreadCount} unread notifications` : ''}</span>
    </div>
  );
}
