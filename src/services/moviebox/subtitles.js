/**
 * Subtitle handling.
 *
 * The provider only returns SubRip (.srt) captions, and browsers do not render
 * SRT in a <video><track>. VEYRA fetches the caption text through the
 * provider's /api/proxy route, converts it to WebVTT in memory and hands the
 * <track> a blob URL. Nothing is cached beyond the current session.
 */
import { buildApiProxyUrl, isApiProxyUrl, unwrapApiProxyUrl } from './client.js';

const TIMESTAMP = /(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2})[,.](\d{1,3})/g;

function pad(value, size = 2) {
  return String(value).padStart(size, '0');
}

function normalizeTimestampLine(line) {
  return line
    .replace(TIMESTAMP, (_match, startHms, startMs, endHms, endMs) => {
      const start = `${startHms}.${pad(startMs.padEnd(3, '0'), 3)}`;
      const end = `${endHms}.${pad(endMs.padEnd(3, '0'), 3)}`;
      return `${start} --> ${end}`;
    })
    // VTT dislikes the cue settings SubRip sometimes carries; keep position only.
    .trim();
}

/** Convert SubRip text to WebVTT. Non-SRT payloads (error pages) are rejected. */
export function srtToVtt(input) {
  const source = String(input || '').replace(/\r\n?/g, '\n').replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('The caption file was empty.');
  if (/^\s*<(?:!doctype|html)/i.test(source)) throw new Error('The caption request returned a web page instead of subtitles.');
  const body = /^WEBVTT/i.test(source) ? source.replace(/^WEBVTT[^\n]*\n?/i, '') : source;
  const blocks = body.split(/\n{2,}/);
  const cues = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim() !== '');
    if (!lines.length) continue;
    let index = 0;
    if (/^\d+$/.test(lines[0].trim()) && lines.length > 1 && TIMESTAMP.test(lines[1])) index = 1;
    TIMESTAMP.lastIndex = 0;
    const timing = lines[index];
    if (!timing || !TIMESTAMP.test(timing)) continue;
    TIMESTAMP.lastIndex = 0;
    const textLines = lines.slice(index + 1).map((line) => line.replace(/<\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}>/g, '').trim());
    cues.push([normalizeTimestampLine(timing), ...textLines].join('\n'));
  }
  if (!cues.length) throw new Error('The caption file had no readable cues.');
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

const trackCache = new Map();

/** Fetch a caption and return a WebVTT blob URL that a <track> can consume. */
export async function loadSubtitleTrack(captionUrl, { signal } = {}) {
  const source = typeof captionUrl === 'string' ? captionUrl.trim() : '';
  if (!source) throw new Error('No subtitle URL was provided.');
  const proxied = isApiProxyUrl(source) ? (buildApiProxyUrl(unwrapApiProxyUrl(source)) || source) : (buildApiProxyUrl(source) || source);
  const cached = trackCache.get(proxied);
  if (cached) return cached;
  const response = await fetch(proxied, { headers: { Accept: 'text/plain, */*' }, signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Subtitle request failed (HTTP ${response.status}).`);
  const text = await response.text();
  const vtt = srtToVtt(text);
  const blobUrl = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt;charset=utf-8' }));
  trackCache.set(proxied, blobUrl);
  return blobUrl;
}

export function releaseSubtitleTracks() {
  for (const url of trackCache.values()) URL.revokeObjectURL(url);
  trackCache.clear();
}
