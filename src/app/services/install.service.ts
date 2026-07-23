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
      // Deliberately *not* calling preventDefault: suppressing it hides the
      // browser's own install affordance, and on a phone that leaves no
      // discoverable way in. Keep the browser's offer and stash the event so
      // the in-app banner and the Settings button can trigger it as well.
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
    // Registration is deferred until the app settles, so poll briefly rather
    // than reading once and concluding it will never happen.
    for (let i = 0; i < 20; i++) {
      try {
        if (!('serviceWorker' in navigator)) return;
        const reg = await navigator.serviceWorker.getRegistration();
        if (navigator.serviceWorker.controller || reg?.active) {
          this.serviceWorkerActive.set(true);
          return;
        }
      } catch {
        return;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /**
   * What the browser needs before it will install, and whether we have it.
   * Surfaced in Settings so a phone that refuses to install can say why —
   * otherwise it's guesswork on a device with no console.
   */
  async diagnostics(): Promise<{ label: string; ok: boolean; detail: string }[]> {
    const secure = typeof window !== 'undefined' && window.isSecureContext;
    const httpsish =
      typeof location !== 'undefined' &&
      (location.protocol === 'https:' || location.hostname === 'localhost');

    let manifestOk = false;
    let manifestDetail = 'no <link rel="manifest">';
    try {
      const href = document.querySelector<HTMLLinkElement>('link[rel=manifest]')?.href;
      if (href) {
        const res = await fetch(href);
        manifestOk = res.ok;
        manifestDetail = res.ok ? new URL(href).pathname : `HTTP ${res.status}`;
      }
    } catch {
      manifestDetail = 'could not be fetched';
    }

    let swDetail = 'not registered';
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg?.active) swDetail = `active, scope ${new URL(reg.scope).pathname}`;
      else if (reg) swDetail = 'registered but not yet active';
    } catch {
      swDetail = 'unavailable';
    }

    return [
      {
        label: 'Secure connection',
        ok: secure && httpsish,
        detail: typeof location !== 'undefined' ? location.protocol.replace(':', '') : '—',
      },
      { label: 'App manifest', ok: manifestOk, detail: manifestDetail },
      { label: 'Service worker', ok: this.serviceWorkerActive(), detail: swDetail },
      {
        label: 'Browser can install',
        ok: this.canPrompt() || this.isIos(),
        detail: this.isIos()
          ? 'iOS — manual, via Share'
          : this.canPrompt()
            ? 'ready'
            : 'no install offer from this browser',
      },
    ];
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
