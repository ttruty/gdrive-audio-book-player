import { Component, inject, input, output, signal } from '@angular/core';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { folderOpenOutline } from 'ionicons/icons';

import { CopyService } from '../services/copy.service';
import { LocalService } from '../services/local.service';

/**
 * A button that opens the device file picker and imports the chosen audio as
 * books — no Google account, no network. Reused on the empty-state landing and
 * inside the "add a book" sheet, so the two entry points behave identically.
 */
@Component({
  selector: 'app-local-add',
  standalone: true,
  imports: [IonIcon, IonSpinner],
  template: `
    <label class="pick" [class.block]="expand()" [class.busy]="busy()">
      <input
        type="file"
        multiple
        accept="audio/*,.m4b,.m4a,.mp3,.aac,.wav,.ogg,.oga,.flac,.opus,.wma,.mp4"
        (change)="onPick($event)"
        [disabled]="busy()"
      />
      @if (busy()) {
        <ion-spinner name="dots" />
        <span>{{ note() || 'Adding…' }}</span>
      } @else {
        <ion-icon name="folder-open-outline" />
        <span>{{ t().addFromDevice }}</span>
      }
    </label>
  `,
  styles: [
    `
      .pick {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        padding: 11px 16px;
        border-radius: var(--yb-radius-button);
        border: 1px solid var(--ion-color-primary);
        color: var(--ion-color-primary);
        background: transparent;
        font-size: 0.9rem;
        font-weight: 600;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      .pick.block {
        display: flex;
        width: 100%;
      }
      .pick.busy {
        opacity: 0.75;
        cursor: default;
      }
      input {
        position: absolute;
        width: 1px;
        height: 1px;
        opacity: 0;
        pointer-events: none;
      }
      ion-spinner {
        width: 18px;
        height: 18px;
      }
      ion-icon {
        font-size: 1.15rem;
      }
    `,
  ],
})
export class LocalAddComponent {
  private local = inject(LocalService);
  readonly t = inject(CopyService).t;

  readonly expand = input(false);

  /** Number of books added. Zero means the picker was cancelled or all failed. */
  readonly added = output<number>();
  readonly failed = output<string>();

  readonly busy = signal(false);
  readonly note = signal('');

  async onPick(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    // Reset the control so re-picking the same file fires change again.
    input.value = '';
    if (!files.length) return;

    this.busy.set(true);
    try {
      const books = await this.local.addFiles(files, (done, total, name) => {
        this.note.set(total > 1 ? `Adding ${done + 1} of ${total}…` : name || 'Reading…');
      });
      this.added.emit(books.length);
    } catch (err: any) {
      this.failed.emit(err?.message ?? 'Those files could not be added.');
    } finally {
      this.busy.set(false);
      this.note.set('');
    }
  }
}
