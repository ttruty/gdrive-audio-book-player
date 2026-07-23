import { Injectable, inject, signal } from '@angular/core';
import { DriveService } from './drive.service';
import { BookmarksService } from './bookmarks.service';
import { CopyService } from './copy.service';
import { Book, Note } from '../models';
import { hhmmss, newId } from '../util/format';

const STORAGE_KEY = 'yarnbeard.notes.v1';
/** bookId → Drive file id of the log we previously wrote, so we overwrite it. */
const EXPORT_KEY = 'yarnbeard.notes.exports.v1';

/**
 * The Cap'n's Log — notes pinned to a moment in a book. Kept locally, synced
 * through the hidden Drive file with everything else, and exportable as a
 * readable Markdown file written straight into the book's own Drive folder.
 */
@Injectable({ providedIn: 'root' })
export class NotesService {
  private drive = inject(DriveService);
  private bookmarks = inject(BookmarksService);
  private copy = inject(CopyService);

  readonly all = signal<Note[]>(this.read());
  private exportIds: Record<string, string> = this.readExports();

  private read(): Note[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as Note[]) : [];
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

  private readExports(): Record<string, string> {
    try {
      const raw = localStorage.getItem(EXPORT_KEY);
      return raw ? (JSON.parse(raw) as Record<string, string>) : {};
    } catch {
      return {};
    }
  }

  private writeExports(): void {
    try {
      localStorage.setItem(EXPORT_KEY, JSON.stringify(this.exportIds));
    } catch {
      /* ignore */
    }
  }

  forBook(bookId: string): Note[] {
    return this.all()
      .filter((n) => n.bookId === bookId)
      .sort((a, b) =>
        a.chapterIndex === b.chapterIndex
          ? a.position - b.position
          : a.chapterIndex - b.chapterIndex
      );
  }

  countForBook(bookId: string): number {
    return this.all().reduce((n, x) => n + (x.bookId === bookId ? 1 : 0), 0);
  }

  /** Newest first, across the whole library — the Log tab's main list. */
  recent(limit = 100): Note[] {
    return [...this.all()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }

  search(query: string): Note[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return this.all().filter((n) => n.text.toLowerCase().includes(q));
  }

  add(note: Omit<Note, 'id' | 'createdAt' | 'updatedAt'>): Note {
    const now = Date.now();
    const created: Note = { ...note, id: newId(), createdAt: now, updatedAt: now };
    this.all.update((list) => [...list, created]);
    this.write();
    return created;
  }

  update(id: string, text: string): void {
    this.all.update((list) =>
      list.map((n) => (n.id === id ? { ...n, text, updatedAt: Date.now() } : n))
    );
    this.write();
  }

  remove(id: string): void {
    this.all.update((list) => list.filter((n) => n.id !== id));
    this.write();
  }

  removeForBook(bookId: string): void {
    this.all.update((list) => list.filter((n) => n.bookId !== bookId));
    this.write();
  }

  // ── export to Drive ──────────────────────────────────────────────────────
  /**
   * Render the log for one book as Markdown, including its bookmarks so the
   * exported file is a complete record of everything marked in that book.
   */
  renderMarkdown(book: Book): string {
    const notes = this.forBook(book.id);
    const marks = this.bookmarks.forBook(book.id);
    const c = this.copy.t();
    const chapterName = (i: number) =>
      book.chapters[i]?.title ?? `Chapter ${i + 1}`;

    const lines: string[] = [
      `# ${c.exportDocTitle} — ${book.title}`,
      '',
      book.author ? `**Author:** ${book.author}  ` : '',
      `**Chapters:** ${book.chapters.length}  `,
      `**Written:** ${new Date().toLocaleString()}  `,
      `**${c.exportKeptBy}**`,
      '',
      '---',
      '',
    ].filter((l) => l !== '');

    if (marks.length) {
      lines.push(`## ${c.exportMarksHeading} (${marks.length})`, '');
      for (const m of marks) {
        lines.push(
          `- **${hhmmss(m.position)}** · ${chapterName(m.chapterIndex)} — ${m.label}`
        );
      }
      lines.push('');
    }

    if (notes.length) {
      lines.push(`## ${c.exportNotesHeading} (${notes.length})`, '');
      let lastChapter = -1;
      for (const n of notes) {
        if (n.chapterIndex !== lastChapter) {
          lines.push('', `### ${n.chapterIndex + 1}. ${chapterName(n.chapterIndex)}`, '');
          lastChapter = n.chapterIndex;
        }
        lines.push(`**[${hhmmss(n.position)}]** ${n.text}`, '');
      }
    }

    if (!marks.length && !notes.length) {
      lines.push(c.exportEmptyLine, '');
    }

    return lines.join('\n');
  }

  /**
   * Write the log into the book's own Drive folder as Markdown. Returns the
   * filename so the UI can tell the user exactly where to look.
   *
   * The `drive.file` scope only ever lets the app touch files it created, so
   * this can add the log next to the audio without gaining read access to the
   * rest of the folder. If Drive refuses (some shared drives disallow it), the
   * caller falls back to a local download.
   */
  async exportToDrive(book: Book): Promise<string> {
    const safeTitle = book.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80);
    const stem = this.copy.t().exportFileStem.replace(/[\\/:*?"<>|']/g, '');
    const name = `${stem} - ${safeTitle}.md`;
    const text = this.renderMarkdown(book);
    const existing = this.exportIds[book.id];

    let fileId: string;
    try {
      fileId = await this.drive.writeTextFile({
        name,
        text,
        existingFileId: existing,
        parentFolderId: book.id,
      });
    } catch (err) {
      // The remembered file may have been deleted or moved — try a fresh one.
      if (!existing) throw err;
      delete this.exportIds[book.id];
      this.writeExports();
      fileId = await this.drive.writeTextFile({
        name,
        text,
        parentFolderId: book.id,
      });
    }

    this.exportIds[book.id] = fileId;
    this.writeExports();
    return name;
  }

  /** Save the log to the device instead — the escape hatch when Drive says no. */
  downloadMarkdown(book: Book): void {
    const blob = new Blob([this.renderMarkdown(book)], {
      type: 'text/markdown;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${this.copy
      .t()
      .exportFileStem.replace(/[^\w\d]+/g, '-')}-${book.title.replace(
      /[^\w\d]+/g,
      '-'
    )}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── sync plumbing ────────────────────────────────────────────────────────
  snapshot(): Note[] {
    return this.all();
  }

  /** Union by id, newest edit wins for notes that exist on both sides. */
  merge(incoming: Note[] | undefined): void {
    if (!Array.isArray(incoming) || !incoming.length) return;
    this.all.update((mine) => {
      const byId = new Map(mine.map((n) => [n.id, n]));
      for (const n of incoming) {
        const ours = byId.get(n.id);
        if (!ours || (n.updatedAt ?? 0) > (ours.updatedAt ?? 0)) byId.set(n.id, n);
      }
      return [...byId.values()];
    });
    this.write();
  }

  replaceAll(list: Note[]): void {
    this.all.set(Array.isArray(list) ? list : []);
    this.write();
  }
}
