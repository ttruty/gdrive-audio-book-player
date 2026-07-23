import { Injectable, signal } from '@angular/core';
import { Bookmark } from '../models';
import { newId } from '../util/format';

const STORAGE_KEY = 'yarnbeard.bookmarks.v1';

/** X marks the spot — saved positions inside a book. */
@Injectable({ providedIn: 'root' })
export class BookmarksService {
  readonly all = signal<Bookmark[]>(this.read());

  private read(): Bookmark[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as Bookmark[]) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.all()));
    } catch {
      /* ignore */
    }
  }

  /** A book's marks, in reading order. */
  forBook(bookId: string): Bookmark[] {
    return this.all()
      .filter((b) => b.bookId === bookId)
      .sort((a, b) =>
        a.chapterIndex === b.chapterIndex
          ? a.position - b.position
          : a.chapterIndex - b.chapterIndex
      );
  }

  countForBook(bookId: string): number {
    return this.all().reduce((n, b) => n + (b.bookId === bookId ? 1 : 0), 0);
  }

  add(mark: Omit<Bookmark, 'id' | 'createdAt'>): Bookmark {
    const bookmark: Bookmark = {
      ...mark,
      label: mark.label?.trim() || 'X marks the spot',
      id: newId(),
      createdAt: Date.now(),
    };
    this.all.update((list) => [...list, bookmark]);
    this.write();
    return bookmark;
  }

  rename(id: string, label: string): void {
    this.all.update((list) =>
      list.map((b) => (b.id === id ? { ...b, label: label.trim() || b.label } : b))
    );
    this.write();
  }

  remove(id: string): void {
    this.all.update((list) => list.filter((b) => b.id !== id));
    this.write();
  }

  removeForBook(bookId: string): void {
    this.all.update((list) => list.filter((b) => b.bookId !== bookId));
    this.write();
  }

  // ── sync plumbing ────────────────────────────────────────────────────────
  snapshot(): Bookmark[] {
    return this.all();
  }

  /** Union by id — bookmarks are append-mostly, so nothing is lost in a merge. */
  merge(incoming: Bookmark[] | undefined): void {
    if (!Array.isArray(incoming) || !incoming.length) return;
    this.all.update((mine) => {
      const byId = new Map(mine.map((b) => [b.id, b]));
      for (const b of incoming) {
        if (!byId.has(b.id)) byId.set(b.id, b);
      }
      return [...byId.values()];
    });
    this.write();
  }

  replaceAll(list: Bookmark[]): void {
    this.all.set(Array.isArray(list) ? list : []);
    this.write();
  }
}
