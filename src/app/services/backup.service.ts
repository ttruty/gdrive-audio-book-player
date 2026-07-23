import { Injectable } from '@angular/core';

/**
 * Everything that makes up a listener's library. Auth tokens and the offline
 * audio cache are deliberately left out: one is a secret, the other is bulk
 * that can always be re-downloaded.
 */
const BACKUP_KEYS = [
  'yarnbeard.books.v1',
  'yarnbeard.shelves.v1',
  'yarnbeard.covers.v1',
  'yarnbeard.progress.v1',
  'yarnbeard.bookmarks.v1',
  'yarnbeard.notes.v1',
  'yarnbeard.notes.exports.v1',
  'yarnbeard.stats.v1',
  'yarnbeard.crests.v1',
  'yarnbeard.settings.v1',
  'yarnbeard.rates.v1',
  'yarnbeard.playback.v1',
];

interface BackupFile {
  app: 'yarnbeard';
  version: 1;
  exportedAt: string;
  data: Record<string, unknown>;
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  /** Write the whole chest out to a file the listener keeps. */
  export(): void {
    const data: Record<string, unknown> = {};
    for (const key of BACKUP_KEYS) {
      const raw = localStorage.getItem(key);
      if (raw == null) continue;
      try {
        data[key] = JSON.parse(raw);
      } catch {
        data[key] = raw;
      }
    }
    const file: BackupFile = {
      app: 'yarnbeard',
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    const blob = new Blob([JSON.stringify(file, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `yarnbeard-chest-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Restore a chest, then reload so every service re-reads storage cleanly. */
  async import(file: File): Promise<void> {
    const parsed = JSON.parse(await file.text()) as BackupFile;
    if (parsed?.app !== 'yarnbeard' || !parsed.data) {
      throw new Error('That is not a Yarnbeard chest file.');
    }
    for (const [key, value] of Object.entries(parsed.data)) {
      if (BACKUP_KEYS.includes(key)) {
        localStorage.setItem(key, JSON.stringify(value));
      }
    }
    location.reload();
  }

  /** Scuttle everything local. The Drive sync file is left untouched. */
  wipeLocal(): void {
    for (const key of BACKUP_KEYS) localStorage.removeItem(key);
    location.reload();
  }
}
