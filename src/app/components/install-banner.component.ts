import { Component, computed, inject, signal } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { closeOutline, downloadOutline, shareOutline } from 'ionicons/icons';

import { CopyService } from '../services/copy.service';
import { InstallService } from '../services/install.service';

const DISMISS_KEY = 'yarnbeard.install.dismissed';

/**
 * A visible offer to install, on the library page where it can actually be
 * found. Settings has the permanent entry, but nobody goes hunting through
 * settings on a phone — and on iOS no prompt ever appears on its own, so
 * without this the feature is effectively invisible there.
 *
 * Dismissible, and it stays dismissed.
 */
@Component({
  selector: 'app-install-banner',
  standalone: true,
  imports: [IonButton, IonIcon],
  template: `
    @if (show()) {
      <div class="banner">
        <div class="text">
          <div class="title">{{ t().installTitle }}</div>
          @if (install.isIos()) {
            <div class="yb-small yb-muted">
              Tap <ion-icon name="share-outline" class="inline" /> <strong>Share</strong>,
              then <strong>Add to Home Screen</strong>.
            </div>
          } @else {
            <div class="yb-small yb-muted">{{ t().installBody }}</div>
          }
        </div>

        @if (!install.isIos()) {
          <ion-button size="small" (click)="doInstall()">
            <ion-icon slot="start" name="download-outline" />
            {{ t().installAction }}
          </ion-button>
        }

        <button class="x" (click)="dismiss()" aria-label="Dismiss">
          <ion-icon name="close-outline" />
        </button>
      </div>
    }
  `,
  styles: [
    `
      .banner {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 12px 16px 4px;
        padding: 12px 12px 12px 14px;
        border-radius: var(--yb-radius-card);
        border: 1px solid var(--ion-color-primary);
        background: rgba(var(--ion-color-primary-rgb), 0.1);
      }
      .text {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-family: var(--yb-heading-family, var(--yb-serif));
        font-size: 0.95rem;
        margin-bottom: 2px;
      }
      .inline {
        vertical-align: -2px;
        font-size: 0.95em;
      }
      ion-button {
        flex: 0 0 auto;
        --padding-start: 10px;
        --padding-end: 10px;
      }
      .x {
        flex: 0 0 auto;
        align-self: flex-start;
        background: none;
        border: none;
        color: var(--yb-muted);
        font-size: 1.05rem;
        padding: 2px;
        cursor: pointer;
      }
    `,
  ],
})
export class InstallBannerComponent {
  readonly install = inject(InstallService);
  readonly t = inject(CopyService).t;

  private dismissed = signal(this.readDismissed());

  readonly show = computed(() => {
    if (this.dismissed() || this.install.installed()) return false;
    // Chromium tells us outright; iOS never will, so offer instructions there.
    return this.install.canPrompt() || this.install.isIos();
  });

  constructor() {
    addIcons({ downloadOutline, closeOutline, shareOutline });
  }

  private readDismissed(): boolean {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  }

  dismiss(): void {
    this.dismissed.set(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
  }

  async doInstall(): Promise<void> {
    const outcome = await this.install.promptInstall();
    // "dismissed" means they said no — don't keep pestering them.
    if (outcome !== 'unavailable') this.dismiss();
  }
}
