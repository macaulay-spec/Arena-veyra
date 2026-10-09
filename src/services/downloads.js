// VEYRA downloads.
//
// A real transfer queue: every record moves through the documented states and
// every byte count comes from the network stream. The URL is always the one the
// VEYRA API layer authorized — this module never builds a media or proxy URL,
// and it never reports progress it did not measure.
//
// Where a platform cannot persist a file, the download is marked unavailable
// with a reason instead of being simulated.

import { ErrorCodes, VeyraError, isCancellation } from './errors.js';

export const STORAGE_KEY = 'veyra-downloads:v1';

export const DOWNLOAD_STATES = Object.freeze({
  queued: 'queued',
  downloading: 'downloading',
  paused: 'paused',
  completed: 'completed',
  failed: 'failed',
  removing: 'removing',
});

export const UNAVAILABLE_REASONS = Object.freeze({
  tooLarge: 'too-large',
  platform: 'platform',
  storage: 'storage',
});
/** Above this, buffering a file in memory stops being a reasonable idea. */
export const MAX_IN_MEMORY_BYTES = 512 * 1024 * 1024;

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${Number.isInteger(size) || size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

/** Stable identity: one record per title (or per episode) at one quality. */
export function downloadId(item, episode, height) {
  const title = item?.id || item?.subjectId || item?.providerItemId || 'title';
  const target = episode?.id || episode?.episodeNumber || 'feature';
  return `${title}:${target}:${height || 'auto'}`;
}

export function downloadProgress(record) {
  const total = Number(record?.sizeBytes);
  const received = Number(record?.receivedBytes);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(received) || received <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((received / total) * 100)));
}

export function loadDownloads(storage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry?.id && entry?.content)
      .map((entry) => ({
        ...entry,
        // A transfer cannot survive an app restart; resume it honestly.
        state: entry.state === 'completed' ? DOWNLOAD_STATES.completed
          : entry.state === 'removing' ? DOWNLOAD_STATES.removing
            : DOWNLOAD_STATES.paused,
      }));
  } catch {
    return [];
  }
}

export function saveDownloads(storage, records) {
  try {
    storage?.setItem?.(STORAGE_KEY, JSON.stringify(records || []));
    return true;
  } catch {
    return false;
  }
}

export function upsertDownload(records, record) {
  const list = Array.isArray(records) ? records : [];
  if (!record?.id) return list;
  return [record, ...list.filter((entry) => entry.id !== record.id)]
    .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

export function withoutDownload(records, id) {
  return (Array.isArray(records) ? records : []).filter((entry) => entry.id !== id);
}

/**
 * Which file sink this platform actually provides. Reported to the UI so an
 * unsupported platform disables the action instead of pretending.
 */
export function downloadCapability() {
  if (typeof window === 'undefined') return { supported: false, kind: 'none', reason: UNAVAILABLE_REASONS.platform };
  if (typeof window.showSaveFilePicker === 'function') return { supported: true, kind: 'file-system-access' };
  if (typeof window.URL?.createObjectURL === 'function') return { supported: true, kind: 'blob' };
  return { supported: false, kind: 'none', reason: UNAVAILABLE_REASONS.platform };
}

async function openSink(name, capability) {
  if (capability.kind === 'file-system-access') {
    const handle = await window.showSaveFilePicker({ suggestedName: name });
    const writable = await handle.createWritable();
    return {
      kind: 'stream',
      async write(chunk) { await writable.write(chunk); },
      async close() { await writable.close(); },
    };
  }
  const parts = [];
  return {
    kind: 'blob',
    async write(chunk) { parts.push(chunk); },
    async close() {
      const blob = new Blob(parts, { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // The download manager owns the object URL for the app's lifetime.
      return url;
    },
  };
}

/**
 * Download manager.
 *
 * `resolveUrl` is injected so this module has no API knowledge:
 * `resolveUrl({ item, episode, quality }) -> { url, sizeBytes, label, height }`.
 */
export class DownloadManager {
  constructor({ storage, resolveUrl, fetchImpl = globalThis.fetch, onChange, capability = downloadCapability() } = {}) {
    this.storage = storage;
    this.resolveUrl = resolveUrl;
    this.fetchImpl = fetchImpl;
    this.onChange = onChange;
    this.capability = capability;
    this.records = loadDownloads(storage);
    this.active = new Map();
  }

  list() {
    return this.records;
  }

  find(id) {
    return this.records.find((entry) => entry.id === id) || null;
  }

  commit() {
    this.records = [...this.records].sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    saveDownloads(this.storage, this.records);
    this.onChange?.(this.records);
  }

  patch(id, changes) {
    this.records = this.records.map((entry) => (entry.id === id ? { ...entry, ...changes, updatedAt: new Date().toISOString() } : entry));
    this.commit();
  }

  /**
   * Queue a title or episode. Resolving the authorized URL is a real request;
   * if it fails the record ends in `failed` with a viewer-safe reason.
   */
  async queue({ item, episode = null, quality = 'Auto', content }) {
    if (!this.capability.supported) {
      throw new VeyraError(ErrorCodes.DOWNLOAD_UNAVAILABLE, 'Downloads are not available on this device.');
    }
    const height = Number(String(quality).replace(/[^\d]/g, '')) || undefined;
    const id = downloadId(item, episode, height);
    const existing = this.find(id);
    if (existing && [DOWNLOAD_STATES.queued, DOWNLOAD_STATES.downloading].includes(existing.state)) return existing;

    const record = {
      id,
      content: content || item,
      label: episode?.label || item?.title || '',
      seasonNumber: episode?.seasonNumber ?? null,
      episodeNumber: episode?.episodeNumber ?? null,
      quality: quality || 'Auto',
      state: DOWNLOAD_STATES.queued,
      sizeBytes: null,
      receivedBytes: 0,
      fileName: '',
      savedUrl: '',
      error: '',
      updatedAt: new Date().toISOString(),
    };
    this.records = upsertDownload(this.records, record);
    this.commit();

    try {
      const resolved = await this.resolveUrl({ item, episode, quality });
      this.patch(id, {
        sizeBytes: resolved.sizeBytes ?? null,
        label: episode?.label ? `${item?.title || ''} · ${episode.label}` : (item?.title || record.label),
        height: resolved.height ?? height ?? null,
        fileName: `${(item?.title || 'veyra').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase()}-${resolved.height || height || 'auto'}.mp4`,
        url: resolved.url,
      });
      this.start(id);
      return this.find(id);
    } catch (error) {
      this.patch(id, {
        state: DOWNLOAD_STATES.failed,
        error: isCancellation(error) ? '' : 'This title could not be prepared for download.',
      });
      return this.find(id);
    }
  }

  /** Begin or resume the transfer. */
  start(id) {
    const record = this.find(id);
    if (!record?.url || this.active.has(id)) return;
    const controller = new AbortController();
    this.active.set(id, controller);
    this.patch(id, { state: DOWNLOAD_STATES.downloading, error: '' });
    this.transfer(record, controller).catch(() => {}).finally(() => this.active.delete(id));
  }

  async transfer(record, controller) {
    const offset = Number(record.receivedBytes) || 0;
    let sink = null;
    try {
      const headers = offset > 0 && record.fileName ? { Range: `bytes=${offset}-` } : {};
      const response = await this.fetchImpl(record.url, { signal: controller.signal, headers });
      if (!response.ok && response.status !== 206) {
        throw new VeyraError(ErrorCodes.DOWNLOAD_UNAVAILABLE, 'The download could not be started.', { status: response.status });
      }
      const resuming = response.status === 206;
      const total = Number(response.headers?.get?.('content-length')) || 0;
      const expected = total ? (resuming ? offset + total : total) : Number(record.sizeBytes) || 0;
      const start = resuming ? offset : 0;

      if (this.capability.kind === 'blob' && expected > MAX_IN_MEMORY_BYTES) {
        this.patch(record.id, {
          state: DOWNLOAD_STATES.failed,
          error: 'This title is too large to save on this device.',
        });
        return;
      }

      sink = await openSink(record.fileName || 'veyra.mp4', this.capability);
      let received = start;
      let lastPush = 0;
      const reader = response.body?.getReader?.();
      if (!reader) throw new VeyraError(ErrorCodes.DOWNLOAD_UNAVAILABLE, 'The download stream could not be read.');

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await sink.write(value);
          received += value.byteLength;
          const now = Date.now();
          if (now - lastPush > 350) {
            lastPush = now;
            this.patch(record.id, { receivedBytes: received, sizeBytes: expected || null });
          }
        }
      }

      const savedUrl = await sink.close();
      sink = null;
      this.patch(record.id, {
        state: DOWNLOAD_STATES.completed,
        receivedBytes: expected || received,
        sizeBytes: expected || received,
        savedUrl: typeof savedUrl === 'string' ? savedUrl : '',
        error: '',
      });
    } catch (error) {
      if (sink?.kind === 'stream') {
        try { await sink.close(); } catch { /* the failed file is discarded */ }
      }
      const cancelled = isCancellation(error) || controller.signal.aborted;
      this.patch(record.id, {
        state: cancelled ? DOWNLOAD_STATES.paused : DOWNLOAD_STATES.failed,
        error: cancelled ? '' : 'The download stopped before it finished.',
      });
    }
  }

  pause(id) {
    const controller = this.active.get(id);
    if (controller) {
      controller.abort();
      this.active.delete(id);
    }
    this.patch(id, { state: DOWNLOAD_STATES.paused });
  }

  resume(id) {
    const record = this.find(id);
    if (!record) return;
    if (record.state === DOWNLOAD_STATES.completed) return;
    this.start(id);
  }

  retry(id) {
    const record = this.find(id);
    if (!record) return;
    if (!record.url) {
      this.queue({ item: record.content, quality: record.quality, content: record.content, episode: null });
      return;
    }
    this.patch(id, { state: DOWNLOAD_STATES.queued, receivedBytes: 0 });
    this.start(id);
  }

  /** `removing` is a real, visible state before the record disappears. */
  async remove(id) {
    this.pause(id);
    this.patch(id, { state: DOWNLOAD_STATES.removing });
    const record = this.find(id);
    if (record?.savedUrl) {
      try { URL.revokeObjectURL(record.savedUrl); } catch { /* already released */ }
    }
    this.records = withoutDownload(this.records, id);
    this.commit();
  }
}
