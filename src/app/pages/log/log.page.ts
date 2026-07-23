import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { create, playCircle, trashOutline } from 'ionicons/icons';

import { BookmarksService } from '../../services/bookmarks.service';
import { CopyService } from '../../services/copy.service';
import { LibraryService } from '../../services/library.service';
import { NotesService } from '../../services/notes.service';
import { PlayerService } from '../../services/player.service';
import { ProgressService } from '../../services/progress.service';
import { StatsService } from '../../services/stats.service';
import { Bookmark, DayStat, Note } from '../../models';
import { hhmmss, humanDuration, relativeTime } from '../../util/format';

type Panel = 'entries' | 'marks' | 'voyage';

/** A note or mark, decorated with the book it belongs to. */
interface LogRow {
  id: string;
  bookId: string;
  bookTitle: string;
  chapterName: string;
  chapterIndex: number;
  position: number;
  text: string;
  at: number;
  kind: 'note' | 'mark';
}

@Component({
  selector: 'app-log',
  standalone: true,
  templateUrl: './log.page.html',
  styleUrls: ['./log.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonSearchbar,
    IonSegment,
    IonSegmentButton,
  ],
})
export class LogPage {
  private library = inject(LibraryService);
  private notes = inject(NotesService);
  private bookmarks = inject(BookmarksService);
  private player = inject(PlayerService);
  private router = inject(Router);
  private alerts = inject(AlertController);
  private toasts = inject(ToastController);

  readonly t = inject(CopyService).t;
  readonly stats = inject(StatsService);
  readonly progress = inject(ProgressService);

  readonly panel = signal<Panel>('entries');
  readonly query = signal('');

  private bookTitle(bookId: string): string {
    return this.library.get(bookId)?.title ?? 'Removed book';
  }

  private chapterName(bookId: string, index: number): string {
    return (
      this.library.get(bookId)?.chapters[index]?.title ?? `Chapter ${index + 1}`
    );
  }

  readonly entries = computed<LogRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    return this.notes
      .all()
      .filter((n) => !q || n.text.toLowerCase().includes(q) ||
        this.bookTitle(n.bookId).toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((n) => this.rowFromNote(n));
  });

  readonly marks = computed<LogRow[]>(() => {
    const q = this.query().trim().toLowerCase();
    return this.bookmarks
      .all()
      .filter((m) => !q || m.label.toLowerCase().includes(q) ||
        this.bookTitle(m.bookId).toLowerCase().includes(q))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((m) => this.rowFromMark(m));
  });

  private rowFromNote(n: Note): LogRow {
    return {
      id: n.id,
      bookId: n.bookId,
      bookTitle: this.bookTitle(n.bookId),
      chapterName: this.chapterName(n.bookId, n.chapterIndex),
      chapterIndex: n.chapterIndex,
      position: n.position,
      text: n.text,
      at: n.updatedAt,
      kind: 'note',
    };
  }

  private rowFromMark(m: Bookmark): LogRow {
    return {
      id: m.id,
      bookId: m.bookId,
      bookTitle: this.bookTitle(m.bookId),
      chapterName: this.chapterName(m.bookId, m.chapterIndex),
      chapterIndex: m.chapterIndex,
      position: m.position,
      text: m.label,
      at: m.createdAt,
      kind: 'mark',
    };
  }

  // ── voyage stats ─────────────────────────────────────────────────────────
  readonly days = computed(() => this.stats.recentDays(14));

  readonly peakDay = computed(() =>
    Math.max(1, ...this.days().map((d) => d.seconds))
  );

  readonly finishedCount = computed(
    () => this.library.books().filter((b) => this.progress.isFinished(b.id)).length
  );

  readonly underwayCount = computed(() => this.library.inProgress().length);

  readonly totalBooks = computed(() => this.library.count());

  readonly noteCount = computed(() => this.notes.all().length);

  constructor() {
    addIcons({ playCircle, create, trashOutline });
  }

  // ── display ──────────────────────────────────────────────────────────────
  clock(seconds: number): string {
    return hhmmss(seconds);
  }

  human(seconds: number): string {
    return humanDuration(seconds);
  }

  relative(ms: number): string {
    return relativeTime(ms);
  }

  barHeight(day: DayStat): number {
    return Math.max(3, Math.round((day.seconds / this.peakDay()) * 100));
  }

  /** "M" for Monday etc — a single initial keeps the strip narrow. */
  dayInitial(day: DayStat): string {
    const d = new Date(`${day.date}T12:00:00`);
    return d.toLocaleDateString(undefined, { weekday: 'narrow' });
  }

  // ── actions ──────────────────────────────────────────────────────────────
  async jump(row: LogRow): Promise<void> {
    const book = this.library.get(row.bookId);
    if (!book) {
      await this.toast('That book is no longer in your library.', 'warning');
      return;
    }
    await this.player.jumpTo(book, row.chapterIndex, row.position);
    void this.router.navigateByUrl('/helm');
  }

  openBook(row: LogRow, ev: Event): void {
    ev.stopPropagation();
    if (this.library.get(row.bookId)) {
      void this.router.navigate(['/tabs/book', row.bookId]);
    }
  }

  async edit(row: LogRow, ev: Event): Promise<void> {
    ev.stopPropagation();
    const alert = await this.alerts.create({
      header:
        row.kind === 'note' ? this.t().noteEditTitle : this.t().markRenameTitle,
      inputs: [
        {
          name: 'text',
          type: row.kind === 'note' ? 'textarea' : 'text',
          value: row.text,
          attributes: row.kind === 'note' ? { rows: 5 } : {},
        },
      ],
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().save,
          handler: (d) => {
            const text = (d.text ?? '').trim();
            if (!text) return;
            if (row.kind === 'note') this.notes.update(row.id, text);
            else this.bookmarks.rename(row.id, text);
          },
        },
      ],
    });
    await alert.present();
  }

  remove(row: LogRow, ev: Event): void {
    ev.stopPropagation();
    if (row.kind === 'note') this.notes.remove(row.id);
    else this.bookmarks.remove(row.id);
  }

  private async toast(message: string, color = 'success'): Promise<void> {
    const t = await this.toasts.create({
      message,
      duration: 2400,
      color,
      position: 'top',
      cssClass: 'yb-toast',
    });
    await t.present();
  }
}
