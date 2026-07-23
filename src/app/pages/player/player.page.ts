import { Component, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import {
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonModal,
  IonRange,
  IonSpinner,
  IonTitle,
  IonToggle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  bookmarkOutline,
  chevronDown,
  create,
  ellipsisHorizontal,
  list,
  moonOutline,
  pause,
  play,
  playBack,
  playForward,
  playSkipBack,
  playSkipForward,
  speedometerOutline,
  volumeHigh,
} from 'ionicons/icons';

import { BookCoverComponent } from '../../components/book-cover.component';
import { CopyService } from '../../services/copy.service';
import { BookmarksService } from '../../services/bookmarks.service';
import { NotesService } from '../../services/notes.service';
import { PlayerService } from '../../services/player.service';
import { ProgressService } from '../../services/progress.service';
import { SettingsService, SLEEP_OPTIONS, SPEED_OPTIONS } from '../../services/settings.service';
import { Chapter } from '../../models';
import { bytes, hhmmss, humanDuration } from '../../util/format';

type Sheet = 'none' | 'speed' | 'sleep' | 'chapters';

@Component({
  selector: 'app-player',
  standalone: true,
  templateUrl: './player.page.html',
  styleUrls: ['./player.page.scss'],
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonRange,
    IonSpinner,
    IonModal,
    IonToggle,
    BookCoverComponent,
  ],
})
export class PlayerPage {
  readonly player = inject(PlayerService);
  readonly settings = inject(SettingsService);
  readonly progress = inject(ProgressService);
  readonly t = inject(CopyService).t;
  private bookmarks = inject(BookmarksService);
  private notes = inject(NotesService);
  private router = inject(Router);
  private toasts = inject(ToastController);
  private alerts = inject(AlertController);

  readonly speeds = SPEED_OPTIONS;
  readonly sleepChoices = SLEEP_OPTIONS;

  readonly sheet = signal<Sheet>('none');
  /** Set while the listener drags the scrubber so it doesn't fight the ticker. */
  readonly scrubbing = signal(false);
  readonly scrubValue = signal(0);

  readonly displayPosition = computed(() =>
    this.scrubbing() ? this.scrubValue() : this.player.position()
  );

  readonly remaining = computed(() =>
    Math.max(0, this.player.duration() - this.displayPosition())
  );

  /** Time left in the chapter at the current speed — the honest number. */
  readonly remainingAtSpeed = computed(() => this.remaining() / (this.player.rate() || 1));

  readonly bookRemaining = computed(() => {
    const b = this.player.book();
    if (!b) return 0;
    this.player.position();
    return this.progress.remaining(b);
  });

  readonly sleepLabel = computed(() => {
    if (this.player.stopAtChapterEnd()) return 'Chapter end';
    const end = this.player.sleepEndsAt();
    if (!end) return this.t().sleepButton;
    const left = Math.max(0, Math.round((end - Date.now()) / 60_000));
    return `${left}m`;
  });

  readonly marksHere = computed(() => {
    const b = this.player.book();
    return b ? this.bookmarks.forBook(b.id) : [];
  });

  /** Whole percent downloaded, or 0 when the size isn't known yet. */
  readonly downloadPct = computed(() => {
    const p = this.player.downloadPercent();
    return p == null ? 0 : Math.round(p * 100);
  });

  /** "12.4 MB of 48.9 MB", or just what's arrived when the total is a mystery. */
  readonly downloadLabel = computed(() => {
    const loaded = this.player.downloadedBytes();
    if (loaded <= 0) return '';
    const total = this.player.downloadTotal();
    return total > 0 ? `${bytes(loaded)} of ${bytes(total)}` : bytes(loaded);
  });

  constructor() {
    addIcons({
      chevronDown,
      play,
      pause,
      playBack,
      playForward,
      playSkipBack,
      playSkipForward,
      bookmarkOutline,
      create,
      moonOutline,
      speedometerOutline,
      list,
      volumeHigh,
      ellipsisHorizontal,
    });
  }

  clock(seconds: number): string {
    return hhmmss(seconds);
  }

  human(seconds: number): string {
    return humanDuration(seconds);
  }

  close(): void {
    void this.router.navigateByUrl('/tabs/hold');
  }

  openBookPage(): void {
    const b = this.player.book();
    if (b) void this.router.navigate(['/tabs/book', b.id]);
  }

  // ── scrubbing ────────────────────────────────────────────────────────────
  onKnobStart(): void {
    this.scrubValue.set(this.player.position());
    this.scrubbing.set(true);
  }

  onScrubInput(value: number): void {
    if (this.scrubbing()) this.scrubValue.set(value);
  }

  onKnobEnd(value: number): void {
    this.scrubbing.set(false);
    this.player.seek(value);
  }

  // ── marks & notes ────────────────────────────────────────────────────────
  async dropMark(): Promise<void> {
    const b = this.player.book();
    const c = this.player.chapter();
    if (!b || !c) return;
    const position = this.player.position();

    this.bookmarks.add({
      bookId: b.id,
      chapterId: c.id,
      chapterIndex: this.player.chapterIndex(),
      position,
      label: `${c.title} · ${hhmmss(position)}`,
    });
    await this.toast(this.t().markToast(hhmmss(position)));
  }

  async writeNote(): Promise<void> {
    const b = this.player.book();
    const c = this.player.chapter();
    if (!b || !c) return;
    const position = this.player.position();
    const wasPlaying = this.player.isPlaying();
    // Pausing while you type is the difference between a note and a scramble.
    if (wasPlaying) this.player.pause();

    const alert = await this.alerts.create({
      header: this.t().noteSheetTitle,
      subHeader: `${c.title} · ${hhmmss(position)}`,
      inputs: [
        {
          name: 'text',
          type: 'textarea',
          placeholder: this.t().notePlaceholder,
          attributes: { rows: 5 },
        },
      ],
      buttons: [
        {
          text: this.t().cancel,
          role: 'cancel',
          handler: () => {
            if (wasPlaying) this.player.togglePlay();
          },
        },
        {
          text: this.t().noteSubmit,
          handler: (d) => {
            const text = (d.text ?? '').trim();
            if (text) {
              this.notes.add({
                bookId: b.id,
                chapterId: c.id,
                chapterIndex: this.player.chapterIndex(),
                position,
                text,
              });
              void this.toast(this.t().noteToast);
            }
            if (wasPlaying) this.player.togglePlay();
          },
        },
      ],
    });
    await alert.present();
  }

  // ── sheets ───────────────────────────────────────────────────────────────
  setSpeed(rate: number): void {
    this.player.setRate(rate);
  }

  startSleep(minutes: number): void {
    this.player.setSleepTimer(minutes);
    // Whatever ye reach for becomes the default the Charts page shows.
    this.settings.sleepMinutes.set(minutes);
    this.sheet.set('none');
    void this.toast(this.t().sleepStarted(minutes));
  }

  sleepAtChapterEnd(): void {
    this.player.setSleepChapterEnd();
    this.sheet.set('none');
    void this.toast(this.t().sleepChapterToast);
  }

  cancelSleep(): void {
    this.player.clearSleep();
    this.sheet.set('none');
  }

  jumpToChapter(chapter: Chapter): void {
    void this.player.playChapter(chapter.index, 0);
    this.sheet.set('none');
  }

  chapterDone(chapter: Chapter): boolean {
    const b = this.player.book();
    return !!b && this.progress.isChapterComplete(b.id, chapter.id);
  }

  chapterDuration(chapter: Chapter): number {
    const b = this.player.book();
    if (!b) return 0;
    return this.progress.get(b.id)?.durations[chapter.id] ?? chapter.duration ?? 0;
  }

  private async toast(message: string): Promise<void> {
    const t = await this.toasts.create({
      message,
      duration: 2200,
      position: 'top',
      color: 'dark',
      cssClass: 'yb-toast',
    });
    await t.present();
  }
}
