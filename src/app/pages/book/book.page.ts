import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonBackButton,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonProgressBar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  bookmark,
  checkmarkCircle,
  cloudDownloadOutline,
  create,
  ellipsisHorizontal,
  play,
  playCircle,
  trashOutline,
  volumeHigh,
} from 'ionicons/icons';

import { BookCoverComponent } from '../../components/book-cover.component';
import { CopyService } from '../../services/copy.service';
import { BookmarksService } from '../../services/bookmarks.service';
import { CrestService } from '../../services/crest.service';
import { LibraryService } from '../../services/library.service';
import { NotesService } from '../../services/notes.service';
import { OfflineService } from '../../services/offline.service';
import { PlayerService } from '../../services/player.service';
import { ProgressService } from '../../services/progress.service';
import { Bookmark, Chapter, Note } from '../../models';
import { hhmmss, humanDuration, relativeTime } from '../../util/format';

type Panel = 'chapters' | 'marks' | 'log';

@Component({
  selector: 'app-book',
  standalone: true,
  templateUrl: './book.page.html',
  styleUrls: ['./book.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonBackButton,
    IonButton,
    IonIcon,
    IonContent,
    IonSegment,
    IonSegmentButton,
    IonProgressBar,
    IonSpinner,
    BookCoverComponent,
  ],
})
export class BookPage {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private toasts = inject(ToastController);
  private alerts = inject(AlertController);
  private sheets = inject(ActionSheetController);

  readonly library = inject(LibraryService);
  readonly progress = inject(ProgressService);
  readonly bookmarks = inject(BookmarksService);
  readonly notes = inject(NotesService);
  readonly offline = inject(OfflineService);
  readonly player = inject(PlayerService);
  readonly t = inject(CopyService).t;
  private crest = inject(CrestService);

  private readonly bookId = signal(this.route.snapshot.paramMap.get('id') ?? '');
  readonly panel = signal<Panel>('chapters');
  readonly busy = signal(false);

  readonly book = computed(() => this.library.get(this.bookId()));

  readonly percent = computed(() => {
    const b = this.book();
    if (!b) return 0;
    // Re-run while the player moves through this book.
    this.player.position();
    return this.progress.percent(b);
  });

  readonly totalTime = computed(() => {
    const b = this.book();
    return b ? this.progress.totalDuration(b) : 0;
  });

  readonly remaining = computed(() => {
    const b = this.book();
    return b ? this.progress.remaining(b) : 0;
  });

  readonly marks = computed(() => this.bookmarks.forBook(this.bookId()));
  readonly entries = computed(() => this.notes.forBook(this.bookId()));

  /**
   * The distinct Drive files behind a book's chapters — one per chapter for a
   * folder book, exactly one for an .m4b however many markers it has.
   */
  readonly fileIds = computed(() => [
    ...new Set((this.book()?.chapters ?? []).map((c) => c.fileId)),
  ]);

  /** Files the listener explicitly downloaded — safe from eviction. */
  readonly stowed = computed(() => this.offline.pinnedCount(this.fileIds()));

  /** Files present offline at all, including ones playback simply kept. */
  readonly cached = computed(() => this.offline.cachedCount(this.fileIds()));

  readonly fullyStowed = computed(
    () => this.fileIds().length > 0 && this.stowed() === this.fileIds().length
  );

  /** Plays offline right now, but was kept by playback rather than chosen. */
  readonly fullyCached = computed(
    () => this.fileIds().length > 0 && this.cached() === this.fileIds().length
  );

  readonly stowJob = computed(() => this.offline.job(this.bookId()));

  readonly isCurrent = computed(() => this.player.book()?.id === this.bookId());

  readonly started = computed(() => this.progress.isStarted(this.bookId()));

  readonly finished = computed(() => this.progress.isFinished(this.bookId()));

  constructor() {
    addIcons({
      play,
      playCircle,
      bookmark,
      create,
      trashOutline,
      cloudDownloadOutline,
      checkmarkCircle,
      ellipsisHorizontal,
      volumeHigh,
    });
  }

  // ── display helpers ──────────────────────────────────────────────────────
  /** Measured if we've played it, otherwise whatever the file's markers said. */
  chapterDuration(chapter: Chapter): number {
    return (
      this.progress.get(this.bookId())?.durations[chapter.id] ??
      chapter.duration ??
      0
    );
  }

  chapterDone(chapter: Chapter): boolean {
    return this.progress.isChapterComplete(this.bookId(), chapter.id);
  }

  chapterPlaying(chapter: Chapter): boolean {
    return this.isCurrent() && this.player.chapter()?.id === chapter.id;
  }

  chapterCached(chapter: Chapter): boolean {
    return this.offline.isCached(chapter.fileId);
  }

  /** How far into the current chapter, so the row can show a sliver of progress. */
  chapterPercent(chapter: Chapter): number {
    const p = this.progress.get(this.bookId());
    if (!p || p.chapterIndex !== chapter.index) return 0;
    const d = p.durations[chapter.id] ?? 0;
    return d > 0 ? Math.min(1, p.position / d) : 0;
  }

  chapterName(index: number): string {
    return this.book()?.chapters[index]?.title ?? `Chapter ${index + 1}`;
  }

  relative(ms: number): string {
    return relativeTime(ms);
  }

  clock(seconds: number): string {
    return hhmmss(seconds);
  }

  human(seconds: number): string {
    return humanDuration(seconds);
  }

  // ── playback ─────────────────────────────────────────────────────────────
  async resume(): Promise<void> {
    const b = this.book();
    if (!b) return;
    await this.player.open(b);
    void this.router.navigateByUrl('/helm');
  }

  async playChapter(chapter: Chapter): Promise<void> {
    const b = this.book();
    if (!b) return;
    await this.player.open(b, { chapterIndex: chapter.index, position: 0 });
    void this.router.navigateByUrl('/helm');
  }

  async jump(target: Bookmark | Note): Promise<void> {
    const b = this.book();
    if (!b) return;
    await this.player.jumpTo(b, target.chapterIndex, target.position);
    void this.router.navigateByUrl('/helm');
  }

  // ── marks ────────────────────────────────────────────────────────────────
  async renameMark(mark: Bookmark): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().markRenameTitle,
      inputs: [{ name: 'label', value: mark.label }],
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().save,
          handler: (d) => this.bookmarks.rename(mark.id, d.label ?? mark.label),
        },
      ],
    });
    await alert.present();
  }

  removeMark(mark: Bookmark): void {
    this.bookmarks.remove(mark.id);
  }

  // ── log entries ──────────────────────────────────────────────────────────
  async addNote(): Promise<void> {
    const b = this.book();
    if (!b) return;
    // Notes land where the listener is if this book is playing, else at the
    // saved reading position — which is what they'd be thinking about.
    const p = this.progress.get(b.id);
    const chapterIndex = this.isCurrent()
      ? this.player.chapterIndex()
      : p?.chapterIndex ?? 0;
    const position = this.isCurrent() ? this.player.position() : p?.position ?? 0;

    const alert = await this.alerts.create({
      header: this.t().noteSheetTitle,
      subHeader: `${this.chapterName(chapterIndex)} · ${hhmmss(position)}`,
      inputs: [
        {
          name: 'text',
          type: 'textarea',
          placeholder: this.t().notePlaceholder,
          attributes: { rows: 5 },
        },
      ],
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().noteSubmit,
          handler: (d) => {
            const text = (d.text ?? '').trim();
            if (!text) return;
            this.notes.add({
              bookId: b.id,
              chapterId: b.chapters[chapterIndex]?.id ?? '',
              chapterIndex,
              position,
              text,
            });
            this.panel.set('log');
          },
        },
      ],
    });
    await alert.present();
  }

  async editNote(note: Note): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().noteEditTitle,
      inputs: [
        {
          name: 'text',
          type: 'textarea',
          value: note.text,
          attributes: { rows: 5 },
        },
      ],
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().save,
          handler: (d) => {
            const text = (d.text ?? '').trim();
            if (text) this.notes.update(note.id, text);
          },
        },
      ],
    });
    await alert.present();
  }

  removeNote(note: Note): void {
    this.notes.remove(note.id);
  }

  /** Write the log (and marks) into the book's own Drive folder as Markdown. */
  async exportLog(): Promise<void> {
    const b = this.book();
    if (!b) return;
    if (!this.entries().length && !this.marks().length) {
      await this.toast('Nothing to export yet.', 'warning');
      return;
    }
    // A local book has no Drive folder — save the log to the device directly.
    if (b.source === 'local') {
      this.notes.downloadMarkdown(b);
      await this.toast('Log downloaded to this device.');
      return;
    }
    this.busy.set(true);
    try {
      const name = await this.notes.exportToDrive(b);
      await this.toast(`Saved "${name}" beside the audio in Drive.`);
    } catch (err: any) {
      const alert = await this.alerts.create({
        header: this.t().exportRefusedTitle,
        message: `${err?.message ?? 'Upload failed.'}\n\nSave the log to this device instead?`,
        buttons: [
          { text: this.t().cancel, role: 'cancel' },
          { text: this.t().saveLocally, handler: () => this.notes.downloadMarkdown(b) },
        ],
      });
      await alert.present();
    } finally {
      this.busy.set(false);
    }
  }

  // ── the hold (offline) ───────────────────────────────────────────────────
  async stow(): Promise<void> {
    const b = this.book();
    if (!b) return;
    const ids = this.fileIds();
    if (this.fullyStowed()) {
      await this.offline.removeBook(ids);
      await this.toast(this.t().stowCleared);
      return;
    }
    const job = await this.offline.downloadBook(b.id, b.title, ids);
    await this.toast(
      job.failed
        ? `Downloaded, but ${job.failed} file(s) failed.`
        : this.t().stowDone
    );
  }

  cancelStow(): void {
    this.offline.cancelBook(this.bookId());
  }

  // ── book actions ─────────────────────────────────────────────────────────
  async actions(): Promise<void> {
    const b = this.book();
    if (!b) return;
    const done = this.finished();
    const local = b.source === 'local';
    const c = this.t();
    const sheet = await this.sheets.create({
      header: b.title,
      buttons: [
        { text: c.renameTitle, handler: () => void this.rename() },
        { text: c.editTags, handler: () => void this.editTags() },
        // A local book has no Drive folder to re-scan from.
        ...(local ? [] : [{ text: c.rescan, handler: () => void this.rescan() }]),
        {
          text: done ? c.markUnread : c.markFinished,
          handler: () => this.progress.markFinished(b.id, !done),
        },
        { text: c.startOver, handler: () => void this.confirmReset() },
        { text: c.newArt, handler: () => this.crest.reroll(b.id) },
        { text: c.exportNotes, handler: () => void this.exportLog() },
        { text: c.cancel, role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async rename(): Promise<void> {
    const b = this.book();
    if (!b) return;
    const alert = await this.alerts.create({
      header: this.t().renameTitle,
      inputs: [
        { name: 'title', value: b.title, placeholder: 'Title' },
        { name: 'author', value: b.author ?? '', placeholder: 'Author' },
      ],
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().save,
          handler: (d) =>
            this.library.edit(b.id, {
              title: (d.title || b.title).trim(),
              author: (d.author || '').trim() || undefined,
            }),
        },
      ],
    });
    await alert.present();
  }

  private async editTags(): Promise<void> {
    const b = this.book();
    if (!b) return;
    const alert = await this.alerts.create({
      header: 'Tags',
      message: 'Separate with commas.',
      inputs: [{ name: 'tags', value: (b.tags ?? []).join(', ') }],
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().save,
          handler: (d) =>
            this.library.edit(b.id, {
              tags: String(d.tags ?? '')
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
            }),
        },
      ],
    });
    await alert.present();
  }

  private async rescan(): Promise<void> {
    this.busy.set(true);
    try {
      const fresh = await this.library.refresh(this.bookId());
      if (this.isCurrent()) this.player.refreshOpenBook();
      await this.toast(`${fresh.chapters.length} chapters.`);
    } catch (err: any) {
      await this.toast(err?.message ?? 'Re-scan failed.', 'danger');
    } finally {
      this.busy.set(false);
    }
  }

  private async confirmReset(): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().startOverTitle,
      message: this.t().startOverBody,
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().startOver,
          role: 'destructive',
          handler: () => this.progress.reset(this.bookId()),
        },
      ],
    });
    await alert.present();
  }

  private async toast(message: string, color = 'success'): Promise<void> {
    const t = await this.toasts.create({
      message,
      duration: 2600,
      color,
      position: 'top',
      cssClass: 'yb-toast',
    });
    await t.present();
  }
}
