import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import {
  ActionSheetController,
  AlertController,
  IonButton,
  IonButtons,
  IonContent,
  IonHeader,
  IonIcon,
  IonInput,
  IonModal,
  IonRefresher,
  IonRefresherContent,
  IonSearchbar,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
  ToastController,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  add,
  cloudDoneOutline,
  cloudOfflineOutline,
  ellipsisHorizontal,
  folderOpenOutline,
  logInOutline,
  playCircle,
  refreshOutline,
  swapVertical,
} from 'ionicons/icons';

import { BookCoverComponent } from '../../components/book-cover.component';
import { DrivePickerComponent } from '../../components/drive-picker.component';
import { InstallBannerComponent } from '../../components/install-banner.component';
import { LandingComponent } from '../../components/landing.component';
import { LocalAddComponent } from '../../components/local-add.component';
import { CopyService } from '../../services/copy.service';
import { GoogleAuthService } from '../../services/google-auth.service';
import { LibraryService } from '../../services/library.service';
import { PlayerService } from '../../services/player.service';
import { ProgressService } from '../../services/progress.service';
import { SyncService } from '../../services/sync.service';
import { Book, ShelfFilter, SortMode } from '../../models';
import { humanDuration, relativeTime } from '../../util/format';

@Component({
  selector: 'app-shelf',
  standalone: true,
  templateUrl: './shelf.page.html',
  styleUrls: ['./shelf.page.scss'],
  imports: [
    FormsModule,
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
    IonRefresher,
    IonRefresherContent,
    IonModal,
    IonInput,
    IonSpinner,
    BookCoverComponent,
    DrivePickerComponent,
    InstallBannerComponent,
    LandingComponent,
    LocalAddComponent,
  ],
})
export class ShelfPage {
  readonly auth = inject(GoogleAuthService);
  readonly library = inject(LibraryService);
  readonly progress = inject(ProgressService);
  readonly player = inject(PlayerService);
  readonly sync = inject(SyncService);
  readonly t = inject(CopyService).t;
  private router = inject(Router);
  private toasts = inject(ToastController);
  private alerts = inject(AlertController);
  private sheets = inject(ActionSheetController);

  readonly query = signal('');
  readonly filter = signal<ShelfFilter>('all');
  readonly sort = signal<SortMode>('recent');

  /** Add-a-book sheet. */
  readonly addOpen = signal(false);
  readonly folderLink = signal('');
  readonly scanning = signal(false);
  readonly scanNote = signal('');
  /**
   * How to read the pasted folder. File-per-book is the default: it's what a
   * folder of .m4b audiobooks wants, and it lets each file's own chapter
   * markers become the chapter list.
   */
  readonly addMode = signal<'files' | 'folder'>('files');

  /** The Drive folder browser modal. */
  readonly pickerOpen = signal(false);

  readonly books = computed(() =>
    this.library.view({
      filter: this.filter(),
      sort: this.sort(),
      query: this.query(),
    })
  );

  readonly continueBook = computed(() => this.library.lastPlayed());

  readonly hasLibrary = computed(() => this.library.count() > 0);

  constructor() {
    addIcons({
      add,
      playCircle,
      refreshOutline,
      swapVertical,
      ellipsisHorizontal,
      folderOpenOutline,
      logInOutline,
      cloudDoneOutline,
      cloudOfflineOutline,
    });
  }

  // ── display helpers ──────────────────────────────────────────────────────
  percent(book: Book): number {
    return this.progress.percent(book);
  }

  finished(book: Book): boolean {
    return this.progress.isFinished(book.id);
  }

  /** The line under a book's title on the shelf. */
  status(book: Book): string {
    const p = this.progress.get(book.id);
    if (p?.finishedAt) return this.t().statusFinished;
    if (!p || (!p.position && !p.chapterIndex)) {
      return this.t().statusUnopened(book.chapters.length);
    }
    const left = this.progress.remaining(book);
    const pct = Math.round(this.progress.percent(book) * 100);
    const when = relativeTime(p.updatedAt);
    return left > 0
      ? `${pct}% · ${humanDuration(left)} left · ${when}`
      : `Chapter ${p.chapterIndex + 1} of ${book.chapters.length} · ${when}`;
  }

  // ── navigation ───────────────────────────────────────────────────────────
  openBook(book: Book): void {
    void this.router.navigate(['/tabs/book', book.id]);
  }

  async resume(book: Book, ev?: Event): Promise<void> {
    ev?.stopPropagation();
    await this.player.open(book);
    void this.router.navigateByUrl('/helm');
  }

  // ── sign in ──────────────────────────────────────────────────────────────
  async signIn(): Promise<void> {
    try {
      await this.auth.signIn(true);
      await this.sync.pull();
      await this.toast(this.t().syncedToast);
    } catch (err: any) {
      await this.toast(err?.message ?? 'Sign-in failed.', 'danger');
    }
  }

  // ── adding books ─────────────────────────────────────────────────────────
  openAdd(): void {
    this.folderLink.set('');
    this.scanNote.set('');
    this.addOpen.set(true);
  }

  /** Open the Drive folder browser, signing in first if needed. */
  async openPicker(): Promise<void> {
    if (!this.auth.isSignedIn()) {
      await this.signIn();
      if (!this.auth.isSignedIn()) return;
    } else if (!this.auth.hasLiveToken()) {
      // Signed in optimistically but the token has lapsed — refresh now, while
      // this tap still counts as the user gesture a popup would need.
      try {
        await this.auth.getValidToken();
      } catch {
        /* the picker shows a Retry if the first listing fails */
      }
    }
    this.pickerOpen.set(true);
  }

  /** A folder was chosen in the browser — scan it with the current mode. */
  async onFolderPicked(folderId: string): Promise<void> {
    this.pickerOpen.set(false);
    this.folderLink.set(folderId);
    await this.addFromLink();
  }

  /** A batch of device files was imported (from the sheet or the landing). */
  async onLocalAdded(count: number): Promise<void> {
    if (!count) return;
    this.addOpen.set(false);
    await this.toast(count === 1 ? 'Book added from this device.' : `${count} books added.`);
  }

  async onLocalFailed(message: string): Promise<void> {
    await this.toast(message, 'danger');
  }

  /**
   * Read whatever was pasted. Each audio file in the folder becomes its own
   * book by default — .m4b files carry their own chapters, so one file really
   * is one audiobook.
   */
  async addFromLink(): Promise<void> {
    const link = this.folderLink().trim();
    if (!link) {
      await this.toast('Paste a Drive folder link first.', 'warning');
      return;
    }
    if (!this.auth.isSignedIn()) {
      await this.signIn();
      if (!this.auth.isSignedIn()) return;
    }

    this.scanning.set(true);
    this.scanNote.set(this.t().scanStart);
    try {
      const added = await this.library.addFromLink(
        link,
        this.addMode(),
        (done, total, name) => {
          this.scanNote.set(
            name ? `Reading ${done + 1} of ${total}: ${name}` : this.t().scanTidy
          );
        }
      );
      this.addOpen.set(false);
      await this.toast(
        added.length === 1
          ? `"${added[0].title}" added.`
          : `${added.length} books added.`
      );
      void this.sync.pushNow(true);
    } catch (err: any) {
      await this.toast(err?.message ?? 'Could not read that folder.', 'danger');
    } finally {
      this.scanning.set(false);
      this.scanNote.set('');
    }
  }

  /** Pull-to-refresh: re-scan saved shelves for anything new. */
  async refresh(ev: CustomEvent): Promise<void> {
    try {
      if (this.auth.isSignedIn() && this.library.shelves().length) {
        const added = await this.library.refreshShelves();
        if (added) await this.toast(`${added} new book(s) found.`);
      }
      await this.sync.pull();
    } catch (err: any) {
      await this.toast(err?.message ?? 'Refresh failed.', 'danger');
    } finally {
      (ev.target as HTMLIonRefresherElement).complete();
    }
  }

  // ── sorting ──────────────────────────────────────────────────────────────
  async pickSort(): Promise<void> {
    const options: { label: string; value: SortMode }[] = [
      { label: 'Last opened', value: 'recent' },
      { label: 'Title', value: 'title' },
      { label: 'Author', value: 'author' },
      { label: 'Recently added', value: 'added' },
      { label: 'Furthest along', value: 'progress' },
    ];
    const sheet = await this.sheets.create({
      header: this.t().sortHeader,
      buttons: [
        ...options.map((o) => ({
          text: o.label + (this.sort() === o.value ? '  ✓' : ''),
          handler: () => {
            this.sort.set(o.value);
          },
        })),
        { text: this.t().cancel, role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  // ── per-book actions ─────────────────────────────────────────────────────
  async bookActions(book: Book, ev: Event): Promise<void> {
    ev.stopPropagation();
    const done = this.progress.isFinished(book.id);
    const c = this.t();
    const sheet = await this.sheets.create({
      header: book.title,
      buttons: [
        { text: c.openBook, handler: () => this.openBook(book) },
        {
          text: done ? c.markUnread : c.markFinished,
          handler: () => {
            this.progress.markFinished(book.id, !done);
          },
        },
        // A local book has no Drive folder to re-scan.
        ...(book.source === 'local'
          ? []
          : [{ text: c.rescan, handler: () => void this.rescan(book) }]),
        { text: c.renameTitle, handler: () => void this.rename(book) },
        {
          text: c.removeAction,
          role: 'destructive',
          handler: () => void this.confirmRemove(book),
        },
        { text: c.cancel, role: 'cancel' },
      ],
    });
    await sheet.present();
  }

  private async rescan(book: Book): Promise<void> {
    try {
      const fresh = await this.library.refresh(book.id);
      await this.toast(`"${fresh.title}" — ${fresh.chapters.length} chapters.`);
    } catch (err: any) {
      await this.toast(err?.message ?? 'Re-scan failed.', 'danger');
    }
  }

  private async rename(book: Book): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().renameTitle,
      inputs: [
        { name: 'title', value: book.title, placeholder: 'Title' },
        { name: 'author', value: book.author ?? '', placeholder: 'Author' },
      ],
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: this.t().save,
          handler: (data) => {
            this.library.edit(book.id, {
              title: (data.title || book.title).trim(),
              author: (data.author || '').trim() || undefined,
            });
          },
        },
      ],
    });
    await alert.present();
  }

  private async confirmRemove(book: Book): Promise<void> {
    const alert = await this.alerts.create({
      header: this.t().removeTitle,
      message: this.t().removeBody(book.title),
      buttons: [
        { text: this.t().cancel, role: 'cancel' },
        {
          text: 'Remove',
          role: 'destructive',
          handler: () => {
            this.library.remove(book.id);
            if (this.player.book()?.id === book.id) this.player.close();
          },
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
