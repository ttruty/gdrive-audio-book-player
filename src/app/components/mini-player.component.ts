import { Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { IonIcon, IonSpinner } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import { pause, play, playSkipForward } from 'ionicons/icons';

import { BookCoverComponent } from './book-cover.component';
import { PlayerService } from '../services/player.service';
import { ProgressService } from '../services/progress.service';
import { bytes, hhmmss } from '../util/format';

/**
 * The deck-level transport: always within thumb's reach, above the tab bar.
 * Tapping the body opens the Helm; the buttons never bubble up to it.
 */
@Component({
  selector: 'app-mini-player',
  standalone: true,
  imports: [IonIcon, IonSpinner, BookCoverComponent],
  template: `
    @if (player.book(); as book) {
      <div class="mini" (click)="openHelm()">
        <!-- While a file is downloading the rail shows *that*, not the
             playhead — otherwise it sits at 0% and looks stuck. -->
        <div class="rail" [class.loading]="player.loading()">
          <span [style.width.%]="player.loading() ? downloadPct() : chapterPercent()"></span>
        </div>

        <app-cover
          [bookId]="book.id"
          [title]="book.title"
          [size]="42"
          [progress]="bookPercent()"
        />

        <div class="text">
          <div class="title yb-truncate">{{ player.chapter()?.title || book.title }}</div>
          <div class="sub yb-truncate yb-small yb-muted">
            @if (player.loading()) {
              {{ loadingLabel() }}
            } @else {
              {{ book.title }} · {{ time() }}
            }
          </div>
        </div>

        <button class="btn" (click)="toggle($event)" [attr.aria-label]="player.isPlaying() ? 'Pause' : 'Play'">
          @if (player.loading()) {
            <ion-spinner name="dots" />
          } @else {
            <ion-icon [name]="player.isPlaying() ? 'pause' : 'play'" />
          }
        </button>

        <button
          class="btn ghost"
          (click)="next($event)"
          [disabled]="!player.hasNext()"
          aria-label="Next chapter"
        >
          <ion-icon name="play-skip-forward" />
        </button>
      </div>
    }
  `,
  styles: [
    `
      .mini {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 10px 8px 12px;
        background: var(--ion-toolbar-background);
        border-top: 1px solid var(--yb-hairline);
        cursor: pointer;
      }
      .rail {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 2px;
        background: var(--yb-hairline);
      }
      .rail > span {
        display: block;
        height: 100%;
        background: var(--ion-color-primary);
        transition: width 0.4s linear;
      }
      /* Thicker while downloading, so the bar reads as a task, not a playhead. */
      .rail.loading {
        height: 3px;
      }
      .rail.loading > span {
        background: var(--ion-color-secondary);
        transition: width 0.2s linear;
      }
      .text {
        flex: 1;
        min-width: 0;
      }
      .title {
        font-size: 0.86rem;
        font-weight: 600;
      }
      .sub {
        margin-top: 1px;
      }
      .btn {
        flex: 0 0 auto;
        width: 40px;
        height: 40px;
        border-radius: 50%;
        border: none;
        display: grid;
        place-items: center;
        background: var(--ion-color-primary);
        color: var(--ion-color-primary-contrast);
        font-size: 1.15rem;
      }
      .btn.ghost {
        background: transparent;
        color: var(--ion-text-color);
        width: 36px;
      }
      .btn:disabled {
        opacity: 0.35;
      }
    `,
  ],
})
export class MiniPlayerComponent {
  readonly player = inject(PlayerService);
  private progress = inject(ProgressService);
  private router = inject(Router);

  constructor() {
    addIcons({ play, pause, playSkipForward });
  }

  readonly chapterPercent = computed(() => {
    const d = this.player.duration();
    return d > 0 ? Math.min(100, (this.player.position() / d) * 100) : 0;
  });

  readonly bookPercent = computed(() => {
    const b = this.player.book();
    if (!b) return 0;
    this.player.position();
    return this.progress.percent(b);
  });

  readonly time = computed(() => {
    const d = this.player.duration();
    return d > 0
      ? `${hhmmss(this.player.position())} / ${hhmmss(d)}`
      : hhmmss(this.player.position());
  });

  readonly downloadPct = computed(() => {
    const p = this.player.downloadPercent();
    return p == null ? 0 : Math.round(p * 100);
  });

  /** "Downloading 42% · 12.4 MB of 48.9 MB", degrading as the numbers thin out. */
  readonly loadingLabel = computed(() => {
    const loaded = this.player.downloadedBytes();
    if (loaded <= 0) return 'Loading…';
    const total = this.player.downloadTotal();
    return total > 0
      ? `Downloading ${this.downloadPct()}% · ${bytes(loaded)} of ${bytes(total)}`
      : `Downloading · ${bytes(loaded)}`;
  });

  openHelm(): void {
    void this.router.navigateByUrl('/helm');
  }

  toggle(ev: Event): void {
    ev.stopPropagation();
    this.player.togglePlay();
  }

  next(ev: Event): void {
    ev.stopPropagation();
    this.player.next();
  }
}
