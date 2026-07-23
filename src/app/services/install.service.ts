import { Injectable, signal } from '@angular/core';

/** The non-standard event Chromium fires when the app meets install criteria. */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallState =
  | 'installed' // already running as an installed app
  | 'ready' // the browser will let us prompt right now
  | 'ios' // Safari never prompts; the user adds it by hand
  | 'unsupported'; // no service worker, or a browser that doesn't install

/**
 * Installing the app to the home screen / dock.
 *
 * Chromium hands us a `beforeinstallprompt` event once the app qualifies —
 * served over a secure origin, with a manifest and an active service worker.
 * We stash it so the app can offer a real button instead of leaving the user
 * to find the icon buried in the address bar. Safari never fires it, so iOS
 * gets written instructions instead.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  private deferred: InstallPromptEvent | null = null;

  readonly canPrompt = signal(false);
  readonly installed = signal(false);
  /** Whether a service worker is actually controlling the page. */
  readonly serviceWorkerActive = signal(false);

  constructor() {
    if (typeof window === 'undefined') return;

    this.installed.set(this.detectStandalone());

    window.addEventListener('beforeinstallprompt', (ev) => {
      // Suppressing the default keeps Chrome's own mini-infobar from appearing,
      // so the button in Settings is the single place this is offered.
      ev.preventDefault();
      this.deferred = ev as InstallPromptEvent;
      this.canPrompt.set(true);
    });

    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canPrompt.set(false);
      this.installed.set(true);
    });

    void this.checkServiceWorker();
  }

  private async checkServiceWorker(): Promise<void> {
    try {
      if (!('serviceWorker' in navigator)) return;
      if (navigator.serviceWorker.controller) {
        this.serviceWorkerActive.set(true);
        return;
      }
      // Registration is deferred until the app is stable, so look again later.
      const reg = await navigator.serviceWorker.getRegistration();
      this.serviceWorkerActive.set(!!reg?.active);
    } catch {
      /* ignore */
    }
  }

  /** True once the app is running from the home screen rather than a tab. */
  private detectStandalone(): boolean {
    try {
      return (
        window.matchMedia?.('(display-mode: standalone)').matches ||
        window.matchMedia?.('(display-mode: minimal-ui)').matches ||
        // Safari's own flag, which predates display-mode.
        (navigator as unknown as { standalone?: boolean }).standalone === true
      );
    } catch {
      return false;
    }
  }

  readonly isIos = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iPadOS 13+ reports itself as a Mac, so the touch check catches those.
    return (
      /iphone|ipad|ipod/i.test(ua) ||
      (/macintosh/i.test(ua) && (navigator.maxTouchPoints ?? 0) > 1)
    );
  };

  state(): InstallState {
    if (this.installed()) return 'installed';
    if (this.canPrompt()) return 'ready';
    if (this.isIos()) return 'ios';
    return 'unsupported';
  }

  /** Show the browser's install dialog. Usable once per captured event. */
  async promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!this.deferred) return 'unavailable';
    try {
      await this.deferred.prompt();
      const { outcome } = await this.deferred.userChoice;
      this.deferred = null;
      this.canPrompt.set(false);
      return outcome;
    } catch {
      return 'unavailable';
    }
  }
}
