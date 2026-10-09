// VEYRA voice.
//
// Technical failures stay in the logs. Everything a viewer reads comes from
// here, so no screen can leak an endpoint, a provider or a status code.

export const copy = Object.freeze({
  offline: {
    title: "You're offline.",
    body: 'Some features may be unavailable until the connection is back.',
  },
  errors: {
    home: "We couldn't load your home screen.",
    discover: "We couldn't load Discover.",
    search: "We couldn't search right now.",
    details: "We couldn't load this title.",
    similar: "We couldn't load more titles like this.",
    episodes: "We couldn't load the episodes.",
    playback: "We couldn't start playback.",
    unavailable: "This title isn’t available to play.",
    unavailableBody: 'It may not be ready to stream yet — try another title.',
    generic: 'Something went wrong.',
  },
  empties: {
    list: { title: 'Your list is empty.', body: 'Save something you want to watch later.' },
    history: { title: 'Nothing here yet.', body: "Watch something and it'll appear here." },
    downloads: { title: 'No downloads yet.', body: 'Save something for offline viewing.' },
    continue: { title: 'Nothing to resume.', body: 'Titles you start watching show up here.' },
    search: { title: 'No results found.', body: 'Try a different title or genre.' },
  },
  actions: {
    retry: 'Try again',
    explore: 'Explore titles',
    backHome: 'Back to home',
  },
  trouble: {
    title: "We're having trouble loading your content.",
    body: 'Check your connection and try again.',
  },
});

/**
 * Map any thrown value onto a line a viewer can read. Returns an empty string
 * for user-initiated cancellations so screens do not flash an error.
 */
export function friendlyError(error, fallback = copy.errors.generic) {
  if (!error) return fallback;
  const code = error.code || error.name || '';
  if (error.name === 'AbortError' || code === 'ABORTED') return '';
  switch (code) {
    case 'TIMEOUT':
    case 'NETWORK_ERROR':
      return "We couldn't reach VEYRA just now.";
    case 'RATE_LIMITED':
      return 'That was a lot of requests. Give it a moment and try again.';
    case 'NOT_CONFIGURED':
    case 'CATALOG_UNAVAILABLE':
    case 'SERVER_ERROR':
    case 'INVALID_RESPONSE':
    case 'UNKNOWN':
      return copy.trouble.title;
    case 'NOT_FOUND':
      return copy.errors.details;
    case 'PLAYBACK_UNAVAILABLE':
    case 'MEDIA_RESOLUTION_FAILED':
      return copy.errors.playback;
    case 'MEDIA_UNAVAILABLE':
      return copy.errors.unavailable;
    case 'SUBTITLES_UNAVAILABLE':
      return 'Subtitles are not available for this title.';
    case 'DOWNLOAD_UNAVAILABLE':
      return 'This title cannot be downloaded right now.';
    default:
      return fallback;
  }
}

/** Short label used under cards and rows, e.g. `2025 · Drama`. */
export function metaLine(item, { max = 2 } = {}) {
  if (!item) return '';
  const parts = [item.year, item.type === 'series' ? 'Series' : item.type === 'movie' ? 'Film' : '', ...(item.genres || [])]
    .filter(Boolean)
    .slice(0, max + 1);
  return parts.join(' · ');
}
