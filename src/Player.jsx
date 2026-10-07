import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  Gauge,
  Languages,
  ListVideo,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { clearMediaCache, pickSource, pickSubtitleTrack, qualityOptions, resolveMedia, resolveStream } from './services/media';
import { episodeCode, formatRemaining, formatTime, isCompleted } from './services/library';
import { copy, friendlyError } from './copy';

const CONTROLS_TIMEOUT_MS = 3400;
const PROGRESS_SAVE_INTERVAL_MS = 5000;
const NEXT_UP_WINDOW_SECONDS = 28;

function Sheet({ title, onClose, children }) {
  return (
    <div className="sheet-backdrop" role="presentation" onClick={onClose}>
      <section className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <header><h2>{title}</h2><button className="sheet-close" onClick={onClose} aria-label={`Close ${title}`}>×</button></header>
        <div className="sheet-body">{children}</div>
      </section>
    </div>
  );
}

function SheetOption({ selected, onClick, children, meta }) {
  return (
    <button className={`sheet-option ${selected ? 'is-selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <span>{children}</span>
      {meta && <small>{meta}</small>}
      <i aria-hidden="true">{selected ? '✓' : ''}</i>
    </button>
  );
}

export default function Player({
  item,
  episode = null,
  episodeLabel = '',
  seasons = [],
  settings,
  nextUp = null,
  startPosition = 0,
  isTV = false,
  onBack,
  onProgress,
  onSelectEpisode,
  onOpenDetails,
}) {
  const videoRef = useRef(null);
  const containerRef = useRef(null);
  const hideTimer = useRef(null);
  const lastSave = useRef(0);
  const dismissedNext = useRef(false);

  const [media, setMedia] = useState(null);
  const [resolution, setResolution] = useState({ loading: true, error: '' });
  const [sourceId, setSourceId] = useState('');
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [sheet, setSheet] = useState('');
  const [mediaError, setMediaError] = useState('');
  const [started, setStarted] = useState(false);
  const [subtitleId, setSubtitleId] = useState('');
  const [quality, setQuality] = useState(settings?.preferredQuality || 'Auto');
  const [qualityBusy, setQualityBusy] = useState(false);
  const [askNext, setAskNext] = useState(false);
  const lastUrl = useRef('');
  const triedFallback = useRef(false);

  const title = item?.title || 'VEYRA';
  const contextLabel = episodeLabel || (episode ? episode.title : '');

  const load = useCallback(async ({ force = false } = {}) => {
    if (!item) return;
    if (force) clearMediaCache();
    setResolution({ loading: true, error: '' });
    setMediaError('');
    try {
      const resolved = await resolveMedia({ item, episode, force });
      setMedia(resolved);
      const preferred = pickSource(resolved, { quality, dataSaver: settings?.dataSaver });
      setSourceId(preferred?.id || '');
      setResolution({ loading: false, error: '' });
    } catch (error) {
      if (error?.code === 'ABORTED') return;
      setMedia(null);
      setResolution({ loading: false, error: friendlyError(error, copy.errors.playback) });
    }
  }, [item, episode, quality, settings?.dataSaver]);

  useEffect(() => { load(); }, [load]);

  const sources = media?.sources || [];
  const source = sources.find((entry) => entry.id === sourceId) || sources[0] || null;
  const subtitles = media?.subtitles || [];
  const subtitleTrack = pickSubtitleTrack(media, { enabled: settings?.subtitles, language: settings?.subtitleLanguage });

  useEffect(() => {
    if (!subtitleTrack) { setSubtitleId(''); return; }
    setSubtitleId(subtitleTrack.id);
  }, [subtitleTrack?.id]);

  const progress = useCallback((value, total) => {
    if (!item) return;
    onProgress?.({
      position: value,
      duration: total,
      completed: isCompleted(value, total),
    });
  }, [item, onProgress]);

  const toggleControls = useCallback(() => setControlsVisible((value) => !value), []);

  const scheduleHide = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    setControlsVisible(true);
    hideTimer.current = window.setTimeout(() => {
      const element = videoRef.current;
      if (element && !element.paused) setControlsVisible(false);
    }, CONTROLS_TIMEOUT_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  const play = useCallback(async () => {
    const element = videoRef.current;
    if (!element) return;
    try {
      await element.play();
      setPlaying(true);
    } catch {
      setPlaying(false);
    }
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
    setControlsVisible(true);
  }, []);

  const seekBy = useCallback((delta) => {
    const element = videoRef.current;
    if (!element) return;
    const next = Math.max(0, Math.min((element.duration || 0), element.currentTime + delta));
    element.currentTime = next;
    setPosition(next);
    scheduleHide();
  }, [scheduleHide]);

  /**
   * Change quality for real. A quality already in the resolved package is used
   * directly; anything else is resolved through the media service and the video
   * element keeps its position while the stream is swapped underneath it.
   */
  const applyQuality = useCallback(async (value) => {
    setSheet('');
    setQuality(value);
    if (!value || value === 'Auto') {
      const preferred = pickSource(media, { quality: 'Auto', dataSaver: settings?.dataSaver });
      if (preferred) setSourceId(preferred.id);
      return;
    }
    const height = Number(String(value).replace(/[^\d]/g, ''));
    const existing = (media?.sources || []).find((entry) => entry.height === height);
    if (existing) {
      setSourceId(existing.id);
      return;
    }
    setQualityBusy(true);
    try {
      const stream = await resolveStream({ item, episode, quality: height });
      const resolved = stream.sources[0];
      if (resolved) {
        setMedia((current) => ({ ...(current || {}), sources: [...(current?.sources || []), resolved] }));
        setSourceId(resolved.id);
      }
    } catch (error) {
      if (error?.code !== 'ABORTED') setMediaError(friendlyError(error, copy.errors.playback));
    } finally {
      setQualityBusy(false);
    }
  }, [media, item, episode, settings?.dataSaver]);

  // Swapping streams keeps the viewer where they were.
  useEffect(() => {
    const element = videoRef.current;
    const url = source?.url;
    if (!element || !url || lastUrl.current === url) return undefined;
    const previous = lastUrl.current ? element.currentTime : 0;
    const wasPlaying = lastUrl.current ? !element.paused : false;
    lastUrl.current = url;
    triedFallback.current = false;
    if (!previous) return undefined;
    const restore = () => {
      try { element.currentTime = previous; } catch { /* seek past the end */ }
      if (wasPlaying) play();
      element.removeEventListener('loadedmetadata', restore);
    };
    element.addEventListener('loadedmetadata', restore);
    return () => element.removeEventListener('loadedmetadata', restore);
  }, [source?.url, play]);

  /** A resolved source may carry a direct fallback if the proxy is unavailable. */
  const handleVideoError = useCallback(() => {
    const element = videoRef.current;
    if (source?.fallbackUrl && !triedFallback.current && element) {
      triedFallback.current = true;
      const at = element.currentTime;
      element.src = source.fallbackUrl;
      element.load();
      const restore = () => { try { element.currentTime = at; } catch { /* ignore */ } element.removeEventListener('loadedmetadata', restore); };
      element.addEventListener('loadedmetadata', restore);
      return;
    }
    setMediaError(copy.errors.playback);
  }, [source?.fallbackUrl]);

  const switchSource = useCallback(async (nextId) => {
    const element = videoRef.current;
    const nextSource = sources.find((entry) => entry.id === nextId);
    if (!element || !nextSource) return;
    const at = element.currentTime;
    const wasPlaying = !element.paused;
    setSourceId(nextId);
    setBuffering(true);
    element.load();
    const apply = () => {
      element.currentTime = at;
      if (wasPlaying) play();
      element.removeEventListener('loadedmetadata', apply);
    };
    element.addEventListener('loadedmetadata', apply);
  }, [sources, play]);

  const toggleFullscreen = useCallback(async () => {
    const element = containerRef.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        setFullscreen(false);
      } else {
        await element.requestFullscreen();
        setFullscreen(true);
      }
    } catch {
      setFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return undefined;
    element.volume = volume;
    element.muted = muted;
    return undefined;
  }, [volume, muted, sourceId]);

  // Subtitle selection is applied directly to the rendered text tracks.
  useEffect(() => {
    const element = videoRef.current;
    if (!element?.textTracks) return;
    Array.from(element.textTracks).forEach((track) => {
      const matched = subtitles.find((entry) => entry.id === subtitleId);
      track.mode = matched && track.language && (matched.language || '').toLowerCase().startsWith(track.language.toLowerCase()) ? 'showing' : 'disabled';
    });
  }, [subtitleId, subtitles, sourceId]);

  const handleTimeUpdate = () => {
    const element = videoRef.current;
    if (!element) return;
    setPosition(element.currentTime);
    const now = Date.now();
    if (now - lastSave.current > PROGRESS_SAVE_INTERVAL_MS && element.duration > 0) {
      lastSave.current = now;
      progress(element.currentTime, element.duration);
    }
  };

  const handleEnded = () => {
    const element = videoRef.current;
    setPlaying(false);
    setControlsVisible(true);
    if (element) progress(element.duration, element.duration);
    if (nextUp && (settings?.autoplayNext ?? true) && !dismissedNext.current) {
      onSelectEpisode?.(nextUp.season, nextUp.episode);
      return;
    }
    setAskNext(Boolean(nextUp));
  };

  useEffect(() => {
    const handleKey = (event) => {
      if (sheet) {
        if (event.key === 'Escape') { event.preventDefault(); setSheet(''); }
        return;
      }
      switch (event.key) {
        case ' ':
        case 'Enter':
          if (document.activeElement?.tagName === 'BUTTON') return;
          event.preventDefault();
          playing ? pause() : play();
          break;
        case 'ArrowRight': event.preventDefault(); seekBy(10); break;
        case 'ArrowLeft': event.preventDefault(); seekBy(-10); break;
        case 'ArrowUp': event.preventDefault(); setMuted(false); setVolume((value) => Math.min(1, Number((value + 0.1).toFixed(2)))); break;
        case 'ArrowDown': event.preventDefault(); setVolume((value) => Math.max(0, Number((value - 0.1).toFixed(2)))); break;
        case 'f': toggleFullscreen(); break;
        case 'm': setMuted((value) => !value); break;
        case 'Escape':
          event.preventDefault();
          onBack?.();
          break;
        default: break;
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [sheet, playing, play, pause, seekBy, toggleFullscreen, onBack]);

  // Flush the final position and release the media element when leaving.
  useEffect(() => () => {
    const element = videoRef.current;
    if (element && element.duration > 0) progress(element.currentTime, element.duration);
  });

  const nearEnd = duration > 0 && duration - position <= NEXT_UP_WINDOW_SECONDS && duration - position > 0;
  const nextLabel = nextUp ? episodeCode(nextUp.seasonIndex ?? 0, nextUp.episodeIndex ?? 0, nextUp.season, nextUp.episode) : '';
  const showNext = Boolean(nextUp) && (askNext || (!dismissedNext.current && nearEnd));
  const qualityList = useMemo(() => qualityOptions(media), [media]);

  const BufferingNotice = buffering && !mediaError && source;

  return (
    <main className={`player ${isTV ? 'player-tv' : ''}`} ref={containerRef}>
      <video
        ref={videoRef}
        className="player-video"
        poster={item?.backdrop || item?.poster || undefined}
        playsInline
        autoPlay
        preload="metadata"
        src={source?.url}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(event) => {
          const element = event.currentTarget;
          setDuration(element.duration || 0);
          if (!started && startPosition > 0 && element.duration && startPosition < element.duration - 5) {
            element.currentTime = startPosition;
            setPosition(startPosition);
          }
          setStarted(true);
        }}
        onPlay={() => { setPlaying(true); scheduleHide(); }}
        onPause={() => setPlaying(false)}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => setBuffering(false)}
        onCanPlay={() => setBuffering(false)}
        onEnded={handleEnded}
        onError={handleVideoError}
        onClick={toggleControls}
        aria-label={`${title} player`}
      >
        {subtitles.map((track) => (
          <track key={track.id} kind="subtitles" src={track.url} srcLang={(track.language || 'en').slice(0, 2).toLowerCase()} label={track.label || track.language} />
        ))}
      </video>

      <div className={`player-ui ${controlsVisible ? 'controls-visible' : ''}`} onClick={toggleControls}>
        <span className="player-scrim player-scrim-top" aria-hidden="true" />
        <span className="player-scrim player-scrim-bottom" aria-hidden="true" />

        <header className="player-top">
          <button className="player-back" onClick={(event) => { event.stopPropagation(); onBack?.(); }} aria-label="Back">
            <ChevronLeft size={22} />
            <span><strong>{title}</strong>{episode && <small>{[nextLabel || contextLabel, episode.title].filter(Boolean).join(' · ')}</small>}</span>
          </button>
          <div className="player-top-actions">
            {onOpenDetails && (
              <button className="player-icon" onClick={(event) => { event.stopPropagation(); onOpenDetails(); }} aria-label="Open title details">
                <ListVideo size={20} />
              </button>
            )}
          </div>
        </header>

        {BufferingNotice && <div className="player-buffering" role="status"><Loader2 size={26} className="spin" /><span>Loading…</span></div>}

        {(mediaError || resolution.error) && (
          <div className="player-error" role="alert">
            <span><Gauge size={22} /></span>
            <h2>{copy.errors.playback}</h2>
            <p>Check your connection and try again.</p>
            <button className="button button-primary" onClick={(event) => { event.stopPropagation(); load({ force: true }); }}>
              <RotateCw size={16} /> {copy.actions.retry}
            </button>
          </div>
        )}

        {!playing && !mediaError && !resolution.loading && !showNext && (
          <button className="player-center" onClick={(event) => { event.stopPropagation(); play(); }} aria-label={position > 0 ? 'Resume' : 'Play'}>
            <Play size={34} fill="currentColor" />
          </button>
        )}

        {resolution.loading && (
          <div className="player-buffering" role="status"><Loader2 size={26} className="spin" /><span>Preparing your film…</span></div>
        )}

        {showNext && (
          <div className="player-next" role="dialog" aria-label="Next episode">
            <span className="eyebrow">Next episode</span>
            <strong>{nextLabel} · {nextUp.episode.title}</strong>
            <div>
              <button className="button button-primary" onClick={(event) => { event.stopPropagation(); onSelectEpisode?.(nextUp.season, nextUp.episode); }}><Play size={16} fill="currentColor" /> Play next</button>
              <button className="button button-glass" onClick={(event) => { event.stopPropagation(); dismissedNext.current = true; setAskNext(false); }}>Dismiss</button>
            </div>
          </div>
        )}

        <div className="player-bottom">
          <div className="player-scrub">
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="1"
              value={Math.min(position, duration || 0)}
              onChange={(event) => { const next = Number(event.target.value); setPosition(next); if (videoRef.current) videoRef.current.currentTime = next; }}
              onPointerUp={() => scheduleHide()}
              aria-label="Seek"
            />
            <div className="player-times">
              <span>{formatTime(position)}</span>
              <span className="player-remaining">{duration ? formatRemaining(position, duration) : ''}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          <div className="player-controls">
            <div className="player-controls-main">
              <button className="player-icon" onClick={(event) => { event.stopPropagation(); seekBy(-10); }} aria-label="Rewind 10 seconds"><RotateCcw size={21} /><small>10</small></button>
              <button className="player-icon player-icon-primary" onClick={(event) => { event.stopPropagation(); playing ? pause() : play(); }} aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
              </button>
              <button className="player-icon" onClick={(event) => { event.stopPropagation(); seekBy(10); }} aria-label="Forward 10 seconds"><RotateCw size={21} /><small>10</small></button>
            </div>
            <div className="player-controls-aside">
              <button className="player-icon" onClick={(event) => { event.stopPropagation(); setMuted((value) => !value); }} aria-label={muted ? 'Unmute' : 'Mute'}>
                {muted || volume === 0 ? <VolumeX size={19} /> : <Volume2 size={19} />}
              </button>
              <button className="player-pill" aria-busy={qualityBusy} onClick={(event) => { event.stopPropagation(); setSheet('quality'); }}><Gauge size={16} /> {qualityBusy ? 'Switching…' : (qualityList.find((option) => option.value === quality)?.label || 'Auto')}</button>
              <button className="player-pill" onClick={(event) => { event.stopPropagation(); setSheet('subtitles'); }}><Languages size={16} /> Subtitles</button>
              {(seasons.length > 0 || sources.length > 1) && (
                <button className="player-pill" onClick={(event) => { event.stopPropagation(); setSheet(seasons.length ? 'episodes' : 'quality'); }}><ListVideo size={16} /> Episodes</button>
              )}
              <button className="player-icon" onClick={(event) => { event.stopPropagation(); toggleFullscreen(); }} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {sheet === 'quality' && (
        <Sheet title="Video quality" onClose={() => setSheet('')}>
          {qualityList.map((option) => (
            <SheetOption key={option.id} selected={quality === option.value} onClick={() => applyQuality(option.value)}>
              {option.label}
            </SheetOption>
          ))}
          {qualityBusy && <p className="sheet-note">Switching quality…</p>}
          {!media?.sources?.length && !qualityBusy && <p className="sheet-note">No other qualities are available for this title.</p>}
        </Sheet>
      )}

      {sheet === 'subtitles' && (
        <Sheet title="Subtitles" onClose={() => setSheet('')}>
          <SheetOption selected={!subtitleId} onClick={() => { setSubtitleId(''); setSheet(''); }}>Off</SheetOption>
          {subtitles.map((track) => (
            <SheetOption key={track.id} selected={subtitleId === track.id} onClick={() => { setSubtitleId(track.id); setSheet(''); }}>
              {track.label || track.language}
            </SheetOption>
          ))}
          {!subtitles.length && <p className="sheet-note">No subtitles are available for this title yet.</p>}
        </Sheet>
      )}

      {sheet === 'episodes' && (
        <Sheet title="Episodes" onClose={() => setSheet('')}>
          {seasons.map((season) => (
            <React.Fragment key={season.id}>
              <p className="sheet-section">{season.label}</p>
              {(season.episodes || []).map((entry, index) => (
                <SheetOption
                  key={entry.id}
                  selected={entry.id === episode?.id}
                  meta={entry.runtime}
                  onClick={() => { setSheet(''); onSelectEpisode?.(season, entry, { index }); }}
                >
                  {episodeCode(0, index, season, entry)} · {entry.title}
                </SheetOption>
              ))}
            </React.Fragment>
          ))}
        </Sheet>
      )}

      <span className="sr-only" aria-live="polite">{mediaError || resolution.error}</span>
    </main>
  );
}
