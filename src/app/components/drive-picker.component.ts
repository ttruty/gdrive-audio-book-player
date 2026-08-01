import { Component, inject, input, output, signal } from '@angular/core';
import {
  IonButton,
  IonButtons,
  IonContent,
  IonFooter,
  IonHeader,
  IonIcon,
  IonModal,
  IonSegment,
  IonSegmentButton,
  IonSpinner,
  IonTitle,
  IonToolbar,
} from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  chevronForward,
  folderOpenOutline,
  folderOutline,
  refreshOutline,
} from 'ionicons/icons';

import { DriveFolder, DriveService } from '../services/drive.service';

interface Crumb {
  id: string;
  name: string;
}

type Location = 'mydrive' | 'shared';

/**
 * An in-app Google Drive folder browser: navigate your own Drive (and folders
 * shared with you) and pick the folder that holds a book, instead of hunting
 * for a share URL. Emits the chosen folder id; the shelf then scans it through
 * the same path a pasted link would.
 */
@Component({
  selector: 'app-drive-picker',
  standalone: true,
  imports: [
    IonModal,
    IonHeader,
    IonToolbar,
    IonTitle,
    IonButtons,
    IonButton,
    IonIcon,
    IonContent,
    IonFooter,
    IonSegment,
    IonSegmentButton,
    IonSpinner,
  ],
  template: `
    <!-- A full-height modal (not a breakpoint sheet): sheets don't reserve
         space for an ion-footer, so the "Add" button ended up below the fold
         with no way to scroll to it. A full modal pins the footer reliably. -->
    <ion-modal
      class="yb-picker"
      [isOpen]="isOpen()"
      (didPresent)="onPresent()"
      (didDismiss)="onDismiss()"
    >
      <ng-template>
        <ion-header class="ion-no-border">
          <ion-toolbar>
            <ion-title>Browse Drive</ion-title>
            <ion-buttons slot="end">
              <ion-button (click)="close()">Close</ion-button>
            </ion-buttons>
          </ion-toolbar>
          <ion-toolbar>
            <ion-segment
              [value]="location()"
              (ionChange)="switchLocation($any($event.detail.value))"
            >
              <ion-segment-button value="mydrive">My Drive</ion-segment-button>
              <ion-segment-button value="shared">Shared with me</ion-segment-button>
            </ion-segment>
          </ion-toolbar>
        </ion-header>

        <ion-content>
          <!-- Breadcrumb trail; tap a crumb to jump back up. -->
          <div class="crumbs">
            @for (c of trail(); track c.id; let i = $index; let last = $last) {
              <button class="crumb" [class.here]="last" (click)="goTo(i)">
                {{ c.name }}
              </button>
              @if (!last) {
                <ion-icon name="chevron-forward" class="sep" />
              }
            }
          </div>

          @if (error()) {
            <div class="notice err">
              {{ error() }}
              <ion-button size="small" fill="clear" (click)="reload()">
                <ion-icon slot="start" name="refresh-outline" />
                Retry
              </ion-button>
            </div>
          } @else if (loading()) {
            <div class="notice"><ion-spinner name="crescent" /></div>
          } @else {
            <div class="list">
              @for (f of folders(); track f.id) {
                <button class="row" (click)="enter(f)">
                  <ion-icon name="folder-outline" class="fi" />
                  <span class="name yb-truncate">{{ f.name }}</span>
                  <ion-icon name="chevron-forward" class="go" />
                </button>
              }
              @if (!folders().length) {
                <div class="notice muted">
                  @if (atRoot()) {
                    Nothing here yet.
                  } @else {
                    No subfolders — if the audiobook files are in this folder,
                    add it below.
                  }
                </div>
              }
            </div>
          }
        </ion-content>

        <ion-footer class="ion-no-border">
          <div class="foot">
            <div class="counts yb-small yb-muted">
              @if (audioCount() > 0) {
                {{ audioCount() }} audio file{{ audioCount() === 1 ? '' : 's' }} here
              } @else if (!atRoot()) {
                no audio files directly here
              }
              @if (folders().length) {
                · {{ folders().length }} folder{{ folders().length === 1 ? '' : 's' }}
              }
            </div>

            <!-- When the folder holds loose audio, ask how to read it: one book
                 whose files are chapters, or a separate book per file. -->
            @if (audioCount() > 0) {
              <div class="modes">
                <button
                  class="m"
                  [class.on]="pickMode() === 'folder'"
                  (click)="pickMode.set('folder')"
                >
                  One book · files are chapters
                </button>
                <button
                  class="m"
                  [class.on]="pickMode() === 'files'"
                  (click)="pickMode.set('files')"
                >
                  A separate book per file
                </button>
              </div>
            }

            <ion-button expand="block" [disabled]="!canAdd()" (click)="pick()">
              <ion-icon slot="start" name="folder-open-outline" />
              Add “{{ current()?.name }}”
            </ion-button>
          </div>
        </ion-footer>
      </ng-template>
    </ion-modal>
  `,
  styles: [
    `
      .crumbs {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 2px;
        padding: 10px 14px;
        border-bottom: 1px solid var(--yb-hairline);
      }
      .crumb {
        background: none;
        border: none;
        color: var(--ion-color-primary);
        font-size: 0.85rem;
        padding: 2px 4px;
        cursor: pointer;
        max-width: 14ch;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .crumb.here {
        color: var(--ion-text-color);
        font-weight: 600;
      }
      .sep {
        color: var(--yb-muted);
        font-size: 0.8rem;
      }
      .notice {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 32px 20px;
        text-align: center;
        color: var(--yb-muted);
        font-size: 0.88rem;
      }
      .notice.err {
        color: var(--ion-color-danger);
        flex-direction: column;
      }
      .list {
        padding: 4px 0 12px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
        padding: 13px 16px;
        border: none;
        border-bottom: 1px solid var(--yb-hairline);
        background: none;
        color: var(--ion-text-color);
        text-align: left;
        cursor: pointer;
      }
      .fi {
        flex: 0 0 auto;
        font-size: 1.3rem;
        color: var(--ion-color-primary);
      }
      .name {
        flex: 1;
        min-width: 0;
        font-size: 0.95rem;
      }
      .go {
        flex: 0 0 auto;
        color: var(--yb-muted);
        font-size: 0.9rem;
      }
      .foot {
        padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
        background: var(--ion-toolbar-background);
        border-top: 1px solid var(--yb-hairline);
      }
      .counts {
        text-align: center;
        margin-bottom: 8px;
        min-height: 1em;
      }
      .modes {
        display: flex;
        gap: 6px;
        margin-bottom: 8px;
      }
      .m {
        flex: 1;
        padding: 8px 6px;
        border-radius: var(--yb-radius-button);
        border: 1px solid var(--yb-hairline);
        background: var(--yb-panel);
        color: var(--yb-muted);
        font-size: 0.74rem;
        line-height: 1.2;
        cursor: pointer;
      }
      .m.on {
        border-color: var(--ion-color-primary);
        color: var(--ion-color-primary);
        font-weight: 600;
      }
    `,
  ],
})
export class DrivePickerComponent {
  private drive = inject(DriveService);

  readonly isOpen = input(false);
  readonly picked = output<{ folderId: string; mode: 'files' | 'folder' }>();
  readonly dismiss = output<void>();

  readonly location = signal<Location>('mydrive');
  readonly trail = signal<Crumb[]>([]);
  readonly folders = signal<DriveFolder[]>([]);
  readonly audioCount = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /**
   * How to read the current folder's loose audio: `folder` = one book whose
   * files are chapters (right for a folder of numbered .mp3s); `files` = a
   * separate book per file (right for a folder of standalone .m4b audiobooks).
   */
  readonly pickMode = signal<'files' | 'folder'>('folder');

  constructor() {
    addIcons({ folderOutline, folderOpenOutline, chevronForward, refreshOutline });
  }

  current(): Crumb | undefined {
    const t = this.trail();
    return t[t.length - 1];
  }

  /** At a virtual root (My Drive / Shared with me), which can't be added. */
  atRoot(): boolean {
    const id = this.current()?.id;
    return id === 'root' || id === 'shared';
  }

  canAdd(): boolean {
    return !this.atRoot() && (this.audioCount() > 0 || this.folders().length > 0);
  }

  // ── lifecycle ──────────────────────────────────────────────────────────
  onPresent(): void {
    if (!this.trail().length) this.loadRoot();
  }

  onDismiss(): void {
    // Reset so the next open starts fresh at the root.
    this.trail.set([]);
    this.folders.set([]);
    this.audioCount.set(0);
    this.error.set(null);
    this.dismiss.emit();
  }

  close(): void {
    this.dismiss.emit();
  }

  // ── navigation ─────────────────────────────────────────────────────────
  switchLocation(loc: Location): void {
    if (loc === this.location()) return;
    this.location.set(loc);
    this.trail.set([]);
    this.loadRoot();
  }

  private loadRoot(): void {
    if (this.location() === 'shared') {
      this.trail.set([{ id: 'shared', name: 'Shared with me' }]);
    } else {
      this.trail.set([{ id: 'root', name: 'My Drive' }]);
    }
    void this.load();
  }

  enter(folder: DriveFolder): void {
    this.trail.update((t) => [...t, folder]);
    void this.load();
  }

  goTo(index: number): void {
    const t = this.trail();
    if (index >= t.length - 1) return;
    this.trail.set(t.slice(0, index + 1));
    void this.load();
  }

  reload(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    const target = this.current();
    if (!target) return;

    this.loading.set(true);
    this.error.set(null);
    try {
      if (target.id === 'shared') {
        // The virtual "shared with me" root: top-level shared folders only.
        this.folders.set(await this.drive.browseSharedWithMe());
        this.audioCount.set(0);
      } else {
        const { folders, audioCount, containerCount } =
          await this.drive.browseChildren(target.id);
        this.folders.set(folders);
        this.audioCount.set(audioCount);
        // Guess the interpretation: mostly container files (.m4b) → a book each
        // (so their embedded chapters are read); loose files (.mp3) → one book
        // with the files as chapters. The user can flip it in the footer.
        if (audioCount > 0) {
          this.pickMode.set(
            containerCount >= Math.ceil(audioCount / 2) ? 'files' : 'folder'
          );
        }
      }
    } catch (err: any) {
      this.folders.set([]);
      this.audioCount.set(0);
      this.error.set(err?.message ?? 'Could not read that folder.');
    } finally {
      this.loading.set(false);
    }
  }

  pick(): void {
    const id = this.current()?.id;
    if (!id || this.atRoot()) return;
    // With no loose audio (a folder of book-subfolders), always use folder mode
    // so each subfolder becomes its own book.
    const mode = this.audioCount() > 0 ? this.pickMode() : 'folder';
    this.picked.emit({ folderId: id, mode });
  }
}
