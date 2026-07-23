import { Component, effect, inject } from '@angular/core';
import { IonApp, IonRouterOutlet } from '@ionic/angular/standalone';

import { GoogleAuthService } from './services/google-auth.service';
import { SettingsService } from './services/settings.service';
import { SyncService } from './services/sync.service';
import { PlayerService } from './services/player.service';
import { LibraryService } from './services/library.service';

@Component({
  selector: 'app-root',
  standalone: true,
  template: '<ion-app><ion-router-outlet></ion-router-outlet></ion-app>',
  imports: [IonApp, IonRouterOutlet],
})
export class AppComponent {
  private auth = inject(GoogleAuthService);
  private sync = inject(SyncService);
  private player = inject(PlayerService);
  private library = inject(LibraryService);
  // Injected for the side effect: the saved theme is applied on construction.
  private settings = inject(SettingsService);

  constructor() {
    // Reuse a saved token (or silently refresh) so returning crew skip the door.
    void this.auth.restoreSession();

    // Once signed in, pull the library down from Drive exactly once per session,
    // then refresh whatever book the player restored so it sees any new chapters.
    // The sync sets its own status signals as it runs, hence allowSignalWrites.
    effect(
      () => {
        if (this.auth.isSignedIn()) {
          void this.sync.pullOnce().then(() => this.player.refreshOpenBook());
        }
      },
      { allowSignalWrites: true }
    );

    // Keyboard shortcuts — for listening at a desk.
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (ev) => this.onKey(ev));
    }
  }

  private onKey(ev: KeyboardEvent): void {
    const el = ev.target as HTMLElement | null;
    const tag = el?.tagName?.toLowerCase();
    if (
      ev.metaKey ||
      ev.ctrlKey ||
      ev.altKey ||
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'ion-input' ||
      tag === 'ion-textarea' ||
      tag === 'ion-searchbar' ||
      el?.isContentEditable
    ) {
      return;
    }
    if (!this.player.book()) return;

    switch (ev.key) {
      case ' ':
        ev.preventDefault();
        this.player.togglePlay();
        break;
      case 'ArrowLeft':
        ev.preventDefault();
        this.player.back();
        break;
      case 'ArrowRight':
        ev.preventDefault();
        this.player.forward();
        break;
      case '[':
        this.player.prev();
        break;
      case ']':
        this.player.next();
        break;
      case '-':
        this.player.nudgeRate(-0.1);
        break;
      case '=':
      case '+':
        this.player.nudgeRate(0.1);
        break;
    }
  }
}
