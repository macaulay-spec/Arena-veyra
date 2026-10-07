import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  CirclePlay,
  Compass,
  Download,
  History,
  Home,
  Play,
  Plus,
  Check,
  Search,
  Star,
  UserRound,
} from 'lucide-react';

/** VEYRA mark: a V that carries a play head. Works on dark, light and artwork. */
export function VeyraMark({ size = 32, className = '', tile = false }) {
  const glyph = (
    <svg className={className} width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <path d="M6 8h7.4L20 21.3 26.6 8H34l-10.4 24h-7.2L6 8Z" fill="currentColor" />
      <path d="M23.4 24.2 30 32h-6.6l-3.4-4.1 3.4-3.7Z" fill="#E5093F" />
    </svg>
  );
  if (!tile) return glyph;
  return (
    <span className={`veyra-mark-tile ${className}`} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
        <rect width="40" height="40" rx="12" fill="#E5093F" />
        <path d="M9.5 9.5h6.7L20 20.6l3.8-11.1h6.7l-8 21h-5L9.5 9.5Z" fill="#fff" />
        <path d="m24.8 23.3 6.3 7.2h-5.8l-3.6-4.2 3.1-3Z" fill="#FF9EAC" />
      </svg>
    </span>
  );
}

export function Brand({ compact = false, onClick, ...props }) {
  return (
    <button className={`brand ${compact ? 'brand-compact' : ''}`} onClick={onClick} aria-label="VEYRA home" {...props}>
      <VeyraMark size={compact ? 26 : 30} />
      {!compact && <span>VEYRA</span>}
    </button>
  );
}

export function Avatar({ name = 'Guest', size = 'small' }) {
  const initial = (name || 'Guest').trim().slice(0, 1).toUpperCase() || 'G';
  return <span className={`avatar avatar-${size}`} aria-hidden="true">{initial}</span>;
}

export function TopBar({ onGo, onSearch, onNotifications, onProfile, isHome = false, active = '', user }) {
  return (
    <header className={`topbar ${isHome ? 'topbar-home' : ''}`}>
      <div className="topbar-left">
        <Brand onClick={() => onGo('home')} />
        <nav className="topbar-links" aria-label="Primary navigation">
          <button className={active === 'home' ? 'toplink active' : 'toplink'} onClick={() => onGo('home')}>Home</button>
          <button className={active === 'discover' ? 'toplink active' : 'toplink'} onClick={() => onGo('discover')}>Discover</button>
          <button className="toplink tv-link" onClick={() => onGo('tv-home')}>For TV <CirclePlay size={14} /></button>
        </nav>
      </div>
      <div className="topbar-actions">
        <button className="icon-button top-search" onClick={onSearch} aria-label="Search"><Search size={19} /></button>
        <button className="icon-button notification-shortcut" onClick={onNotifications} aria-label="Notifications"><History size={18} /></button>
        <button className="avatar-button" onClick={onProfile} aria-label="Open profile"><Avatar name={user?.name || 'Guest'} /></button>
      </div>
    </header>
  );
}

const navItems = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'list', label: 'My List', icon: Bookmark },
  { id: 'profile', label: 'Me', icon: UserRound },
];

export function BottomNav({ active, onGo }) {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {navItems.map(({ id, label, icon: Icon }) => (
        <button key={id} className={`bottom-nav-item ${active === id ? 'is-active' : ''}`} onClick={() => onGo(id)} aria-current={active === id ? 'page' : undefined}>
          <span className="nav-icon-wrap"><Icon size={19} strokeWidth={active === id ? 2.2 : 1.7} /></span>
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function BackButton({ onClick, label = 'Back' }) {
  return <button className="back-button" onClick={onClick} aria-label={label}><ArrowLeft size={19} /><span>{label}</span></button>;
}

export function ProgressBar({ value = 0, className = '' }) {
  return (
    <div className={`progress-track ${className}`} role="progressbar" aria-valuenow={value} aria-valuemin="0" aria-valuemax="100" aria-label={`${value}% watched`}>
      <span className="progress-fill" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function PosterCard({ item, onClick, onPlay, progress, subtitle, onRemove, tvFocus = false, compact = false }) {
  if (!item) return null;
  const label = subtitle || [item.year, item.type === 'series' ? 'Series' : item.genres?.[0]].filter(Boolean).join('  ·  ');
  return (
    <article className={`poster-card-wrap ${compact ? 'poster-compact' : ''}`}>
      <button className="poster-card" onClick={() => onClick?.(item)} data-tv-focus={tvFocus ? 'true' : undefined} aria-label={`Open ${item.title}`}>
        <span className="poster-art">
          {item.poster ? <img src={item.poster} alt="" loading="lazy" decoding="async" onError={(event) => event.currentTarget.remove()} /> : <span className="poster-art-fallback" aria-hidden="true" />}
          <span className="poster-vignette" />
          {item.type === 'series' && <span className="poster-kind">Series</span>}
          {progress != null && <ProgressBar value={progress} className="poster-progress" />}
        </span>
        <span className="poster-copy">
          <strong>{item.title}</strong>
          {label && <span>{label}</span>}
        </span>
      </button>
      {onPlay && (
        <button className="poster-play" onClick={() => onPlay(item)} aria-label={`Resume ${item.title}`} data-tv-focus={tvFocus ? 'true' : undefined}>
          <Play size={15} fill="currentColor" />
        </button>
      )}
      {onRemove && <button className="poster-remove" onClick={() => onRemove(item)} aria-label={`Remove ${item.title} from My List`}><span aria-hidden="true">×</span></button>}
    </article>
  );
}

export function ContentRail({ title, eyebrow, items = [], onItemClick, onPlayItem, progressFor, actionLabel = '', onAction, compact = false, tvFocus = false }) {
  if (!items.length) return null;
  return (
    <section className={`content-rail ${compact ? 'rail-compact' : ''}`}>
      <div className="rail-heading">
        <div>
          {eyebrow && <span className="eyebrow">{eyebrow}</span>}
          <h2>{title}</h2>
        </div>
        {onAction && actionLabel && <button className="rail-action" onClick={onAction}>{actionLabel}<ChevronRight size={15} /></button>}
      </div>
      <div className="rail-track">
        {items.map((item) => (
          <PosterCard
            key={item.id}
            item={item}
            onClick={onItemClick}
            onPlay={onPlayItem}
            progress={progressFor?.(item.id)}
            tvFocus={tvFocus}
            compact={compact}
          />
        ))}
      </div>
    </section>
  );
}

/**
 * Featured hero. Supports several titles with swipe, arrow controls and D-pad
 * movement; a single featured title simply has no pagination.
 */
export function HeroCarousel({ items = [], isSaved, onToggleSaved, onOpen, onPlay, primaryLabel, isTV = false }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const pointerStart = useRef(null);
  const hero = items[index] || items[0] || null;
  const many = items.length > 1;

  useEffect(() => {
    if (!many || paused) return undefined;
    const timer = window.setInterval(() => setIndex((value) => (value + 1) % items.length), 9000);
    return () => window.clearInterval(timer);
  }, [many, paused, items.length]);

  useEffect(() => {
    if (index > items.length - 1) setIndex(0);
  }, [items.length, index]);

  if (!hero) return null;
  const go = (delta) => { setPaused(true); setIndex((value) => (value + delta + items.length) % items.length); };

  return (
    <section
      className="hero"
      aria-roledescription="carousel"
      aria-label="Featured titles"
      onPointerDown={(event) => { pointerStart.current = event.clientX; }}
      onPointerUp={(event) => {
        if (pointerStart.current == null) return;
        const delta = event.clientX - pointerStart.current;
        pointerStart.current = null;
        if (Math.abs(delta) > 48) go(delta < 0 ? 1 : -1);
      }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="hero-art">
        {hero.backdrop && <img key={hero.id} src={hero.backdrop} alt="" onError={(event) => event.currentTarget.remove()} />}
      </div>
      <div className="hero-wash" />
      <div className="hero-content">
        <span className="hero-kicker"><VeyraMark size={15} /> Featured</span>
        <h1>{hero.title}</h1>
        <div className="hero-meta">
          {hero.rating && <span className="rating-chip"><Star size={12} fill="currentColor" /> {hero.rating}</span>}
          {hero.year && <span>{hero.year}</span>}
          {hero.runtime && <span>{hero.runtime}</span>}
          {hero.type === 'series' && <span>Series</span>}
          {hero.genres?.length > 0 && <span>{hero.genres.slice(0, 2).join(' · ')}</span>}
        </div>
        {hero.synopsis && <p className="hero-description">{hero.synopsis}</p>}
        <div className="hero-actions">
          <button className="button button-primary" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onPlay(hero)}><Play size={16} fill="currentColor" /> {primaryLabel(hero)}</button>
          <button
            className={`button button-glass ${isSaved?.(hero.id) ? 'is-saved' : ''}`}
            data-tv-focus={isTV ? 'true' : undefined}
            onClick={() => onToggleSaved(hero)}
          >
            {isSaved?.(hero.id) ? <Check size={16} /> : <Plus size={17} />}{isSaved?.(hero.id) ? 'In My List' : 'My List'}
          </button>
          <button className="button button-quiet" data-tv-focus={isTV ? 'true' : undefined} onClick={() => onOpen(hero)}>Details <ChevronRight size={15} /></button>
        </div>
      </div>

      {many && (
        <>
          <div className="hero-controls">
            <button className="hero-arrow" onClick={() => go(-1)} aria-label="Previous featured title"><ChevronLeft size={18} /></button>
            <button className="hero-arrow" onClick={() => go(1)} aria-label="Next featured title"><ChevronRight size={18} /></button>
          </div>
          <div className="hero-dots" role="tablist" aria-label="Featured titles">
            {items.map((entry, dotIndex) => (
              <button
                key={entry.id}
                role="tab"
                aria-selected={dotIndex === index}
                aria-label={entry.title}
                className={dotIndex === index ? 'is-active' : ''}
                onClick={() => { setPaused(true); setIndex(dotIndex); }}
              />
            ))}
          </div>
        </>
      )}
      <div className="hero-footer-note"><span>VEYRA</span><i /><span>{hero.type === 'series' ? 'A story in episodes' : 'A film to keep'}</span></div>
    </section>
  );
}

export function EmptyState({ icon: Icon = Bookmark, eyebrow = '', title, description, actionLabel, onAction, quiet = false }) {
  return (
    <div className={`empty-state ${quiet ? 'empty-quiet' : ''}`}>
      <span className="empty-icon"><Icon size={24} strokeWidth={1.5} /></span>
      {eyebrow && <span className="eyebrow">{eyebrow}</span>}
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {actionLabel && <button className="button button-secondary" onClick={onAction}>{actionLabel}<ChevronRight size={16} /></button>}
    </div>
  );
}

export function ErrorState({ title = 'Something went wrong.', description = "We couldn't load this right now.", onRetry, retryLabel = 'Try again' }) {
  return (
    <div className="error-state" role="alert">
      <span className="error-mark" aria-hidden="true">!</span>
      <div><h2>{title}</h2>{description && <p>{description}</p>}</div>
      {onRetry && <button className="button button-secondary" onClick={onRetry}>{retryLabel}</button>}
    </div>
  );
}

export function PageTitle({ eyebrow, title, description, right }) {
  return (
    <div className="page-title-row">
      <div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>
      {right}
    </div>
  );
}

export function SearchEmpty({ popular = [], onPick }) {
  return (
    <div className="search-empty">
      <span className="search-empty-mark"><Compass size={24} strokeWidth={1.4} /></span>
      <h2>Find something worth watching.</h2>
      <p>Search a title, a genre, or a mood.</p>
      {popular.length > 0 && (
        <div className="trending-searches">
          <span className="eyebrow">Popular right now</span>
          <div>
            {popular.map((word, index) => (
              <button key={`${word}-${index}`} onClick={() => onPick?.(word)}>
                <span>{String(index + 1).padStart(2, '0')}</span>{word}<ChevronRight size={14} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function RecentSearches({ items = [], onPick, onClear }) {
  if (!items.length) return null;
  return (
    <div className="recent-searches">
      <div className="rail-heading"><h2>Recent</h2><button className="rail-action" onClick={onClear}>Clear</button></div>
      <div className="recent-list">
        {items.map((term) => (
          <button key={term} className="recent-chip" onClick={() => onPick(term)}><Search size={14} />{term}</button>
        ))}
      </div>
    </div>
  );
}

function SkeletonBlock({ className = '' }) {
  return <span className={`skeleton ${className}`} aria-hidden="true" />;
}

export function HeroSkeleton() {
  return (
    <section className="hero hero-skeleton" aria-label="Loading featured titles">
      <div className="hero-art"><SkeletonBlock className="skeleton-hero-art" /></div>
      <div className="hero-wash" />
      <div className="hero-content">
        <SkeletonBlock className="skeleton-line short" />
        <SkeletonBlock className="skeleton-line title" />
        <SkeletonBlock className="skeleton-line" />
        <div className="hero-actions"><SkeletonBlock className="skeleton-button" /><SkeletonBlock className="skeleton-button" /></div>
      </div>
    </section>
  );
}

export function RailSkeleton({ title = true, count = 5, compact = false }) {
  return (
    <section className="content-rail" aria-label="Loading titles">
      {title && <div className="rail-heading"><SkeletonBlock className="skeleton-line label" /></div>}
      <div className={`rail-track skeleton-rail ${compact ? 'rail-compact' : ''}`}>
        {Array.from({ length: count }, (_, index) => <SkeletonBlock key={index} className="skeleton-poster" />)}
      </div>
    </section>
  );
}

export function GridSkeleton({ count = 8 }) {
  return (
    <div className="poster-grid skeleton-grid" aria-label="Loading titles">
      {Array.from({ length: count }, (_, index) => <SkeletonBlock key={index} className="skeleton-poster" />)}
    </div>
  );
}

export function ListSkeleton({ count = 4 }) {
  return (
    <div className="skeleton-row-list" aria-label="Loading results">
      {Array.from({ length: count }, (_, index) => (
        <div className="skeleton-row" key={index}><SkeletonBlock className="skeleton-thumb" /><span className="skeleton-copy"><SkeletonBlock className="skeleton-line" /><SkeletonBlock className="skeleton-line short" /></span></div>
      ))}
    </div>
  );
}

export function EpisodeSkeleton({ count = 3 }) {
  return (
    <div className="episode-list" aria-label="Loading episodes">
      {Array.from({ length: count }, (_, index) => (
        <div className="episode-row episode-skeleton" key={index}>
          <SkeletonBlock className="skeleton-thumb" />
          <div className="episode-copy"><SkeletonBlock className="skeleton-line short" /><SkeletonBlock className="skeleton-line" /></div>
        </div>
      ))}
    </div>
  );
}

export function DetailSkeleton() {
  return (
    <section className="detail-hero detail-skeleton" aria-label="Loading title">
      <div className="detail-art-wash" />
      <div className="detail-hero-layout">
        <div className="detail-copy">
          <SkeletonBlock className="skeleton-line short" />
          <SkeletonBlock className="skeleton-line title" />
          <SkeletonBlock className="skeleton-line" />
          <SkeletonBlock className="skeleton-line short" />
          <div className="detail-actions"><SkeletonBlock className="skeleton-button" /><SkeletonBlock className="skeleton-button" /></div>
        </div>
      </div>
    </section>
  );
}

export function ProfileSkeleton() {
  return (
    <div className="profile-skeleton" aria-label="Loading profile">
      <div className="skeleton-profile-row"><SkeletonBlock className="skeleton-avatar" /><span><SkeletonBlock className="skeleton-line" /><SkeletonBlock className="skeleton-line short" /></span></div>
      {Array.from({ length: 5 }, (_, index) => <SkeletonBlock key={index} className="skeleton-line row" />)}
    </div>
  );
}

export function StorageNote({ children }) {
  return <p className="storage-note"><Download size={15} /> {children}</p>;
}

export function MiniAction({ children, onClick, label }) {
  return <button className="mini-action" onClick={onClick} aria-label={label}>{children}</button>;
}

export { Plus, Check };
