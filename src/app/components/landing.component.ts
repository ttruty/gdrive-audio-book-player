import { Component, output } from '@angular/core';
import { IonButton, IonIcon } from '@ionic/angular/standalone';
import { addIcons } from 'ionicons';
import {
  bookmarkOutline,
  cloudDownloadOutline,
  createOutline,
  logInOutline,
  playCircleOutline,
} from 'ionicons/icons';

import { environment } from '../../environments/environment';

/**
 * The signed-out home page.
 *
 * This is the URL Google's OAuth reviewer lands on, so it is written for a
 * first-time visitor and a reviewer, not for the pirate theme: the app's name
 * and purpose are stated plainly and up front, the Google-account access is
 * described honestly, and the privacy policy and terms are linked. The rest of
 * the app keeps its character; this page earns the verification.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [IonButton, IonIcon],
  template: `
    <div class="landing">
      <header class="hero">
        <img class="mark" src="icons/flag.svg" alt="Yarnbeard logo" width="88" height="88" />
        <h1>Yarnbeard</h1>
        <p class="tagline">An audiobook player for your Google Drive.</p>
      </header>

      <p class="lede">
        Yarnbeard plays the audiobooks and audio files you already keep in your
        own Google Drive, and remembers exactly where you left off in every book
        — along with your bookmarks and notes. It runs entirely in your browser:
        there is no separate account and no server storing your data.
      </p>

      <ion-button class="cta" size="large" (click)="signIn.emit()">
        <ion-icon slot="start" name="log-in-outline" />
        Sign in with Google
      </ion-button>
      <p class="cta-note">
        Sign in with your Google account to open your Drive. You choose which
        folders to add.
      </p>

      <h2 class="section">What you can do</h2>
      <ul class="features">
        <li>
          <ion-icon name="play-circle-outline" />
          <div>
            <strong>Play your audiobooks from Drive</strong>
            <span>MP3 and M4B files, with chapters read from the file itself.</span>
          </div>
        </li>
        <li>
          <ion-icon name="bookmark-outline" />
          <div>
            <strong>Resume where you left off</strong>
            <span>Every book keeps its own place, speed, and bookmarks.</span>
          </div>
        </li>
        <li>
          <ion-icon name="create-outline" />
          <div>
            <strong>Take notes, saved to your Drive</strong>
            <span>Pin notes to a moment and export them back into the book's folder.</span>
          </div>
        </li>
        <li>
          <ion-icon name="cloud-download-outline" />
          <div>
            <strong>Listen offline</strong>
            <span>Download books to play with no connection.</span>
          </div>
        </li>
      </ul>

      <h2 class="section">What it uses from your Google Account</h2>
      <p class="access">
        Yarnbeard reads only the Drive folders you point it at, so it can play
        the audio inside them. It saves your listening progress, bookmarks, and
        notes to a private area of your own Drive so they follow you between
        devices, and — only when you ask — writes a notes file into a book's
        folder. It never reads your other files, and none of your data is sent
        to the developer or anyone else.
      </p>

      <p class="legal">
        <a [href]="privacyHref" target="_blank" rel="noopener">Privacy Policy</a>
        <span class="sep">·</span>
        <a [href]="termsHref" target="_blank" rel="noopener">Terms of Service</a>
      </p>

      @if (notConfigured) {
        <p class="warn">
          No Google Client ID is configured, so sign-in is disabled. Set
          <code>googleClientId</code> in <code>environment.ts</code>.
        </p>
      }

      <footer class="foot">
        Yarnbeard is a free, open-source audiobook player for Google Drive.
      </footer>
    </div>
  `,
  styleUrl: './landing.component.scss',
})
export class LandingComponent {
  readonly signIn = output<void>();

  // Relative, so they resolve under whatever base href the build used
  // (e.g. a GitHub Pages project subpath).
  readonly privacyHref = 'privacy.html';
  readonly termsHref = 'terms.html';

  readonly notConfigured =
    !environment.googleClientId || environment.googleClientId.includes('PASTE');

  constructor() {
    addIcons({
      logInOutline,
      playCircleOutline,
      bookmarkOutline,
      createOutline,
      cloudDownloadOutline,
    });
  }
}
