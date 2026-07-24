import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';

// google.accounts.oauth2 comes from the GIS script loaded in index.html.
declare const google: any;

/**
 * Three scopes, each earning its keep:
 *   drive.readonly — list folders and download the audio
 *   drive.file     — write the Cap'n's Log export back into a book's folder
 *                    (per-file: only touches files this app creates)
 *   drive.appdata  — the hidden sync file holding progress/bookmarks/notes
 */
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/drive.appdata',
].join(' ');

const STORAGE_KEY = 'yarnbeard.auth.v1';

interface StoredSession {
  token: string;
  expiresAt: number;
  consented: boolean;
}

@Injectable({ providedIn: 'root' })
export class GoogleAuthService {
  private tokenClient: any = null;
  private expiresAt = 0;
  private consented = false;
  private pendingResolve: ((token: string) => void) | null = null;
  private pendingReject: ((err: unknown) => void) | null = null;
  /** Coalesces concurrent refreshes so one 401 storm doesn't open five popups. */
  private inFlight: Promise<string> | null = null;
  /** Fires a silent refresh shortly before the token would lapse. */
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  /** Rate-limits the on-resume refresh so returning to the app can't spam it. */
  private lastResumeAttempt = 0;

  readonly accessToken = signal<string | null>(null);
  /**
   * Whether the user has a standing Google connection. True while a live token
   * is held AND while consent stands but the token has merely lapsed — in the
   * latter case the app stays usable and refreshes lazily, rather than bouncing
   * the user back to a sign-in screen.
   */
  readonly isSignedIn = signal(false);
  /** True only when a usable (unexpired) access token is in hand. */
  readonly hasLiveToken = signal(false);

  constructor() {
    this.restoreFromStorage();

    // Google access tokens last about an hour with no refresh token, so keep
    // the session alive while the app is in use: refresh a little before the
    // token lapses, and again when the app is brought back to the foreground.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void this.refreshIfStale();
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', () => void this.refreshIfStale());
      window.addEventListener('online', () => void this.refreshIfStale());
    }
  }

  get configured(): boolean {
    const id = environment.googleClientId;
    return !!id && !id.includes('PASTE');
  }

  private restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as StoredSession;
      this.consented = !!s.consented;
      if (s.token && Date.now() < s.expiresAt - 60_000) {
        this.accessToken.set(s.token);
        this.expiresAt = s.expiresAt;
        this.isSignedIn.set(true);
        this.hasLiveToken.set(true);
        this.scheduleProactiveRefresh();
      } else if (this.consented && this.configured) {
        // Consent stands but the token has lapsed. Keep the user signed in so
        // they see their library, and refresh lazily — on resume, or on their
        // next Drive action (which carries the user gesture a popup needs).
        this.isSignedIn.set(true);
      }
    } catch {
      /* corrupt/unavailable storage — sail on signed out */
    }
  }

  /** Refresh a few minutes before the current token would lapse. */
  private scheduleProactiveRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    const lead = 5 * 60_000;
    const delay = this.expiresAt - Date.now() - lead;
    // setTimeout tops out around 24.8 days; anything sane fits well inside that.
    if (delay > 0 && delay < 2_000_000_000) {
      this.refreshTimer = setTimeout(() => {
        void this.signIn(false).catch(() => {
          /* silent refresh failed — the next Drive action will re-auth */
        });
      }, delay);
    }
  }

  /**
   * Attempt a silent refresh when the token has (nearly) lapsed. Called when the
   * app regains focus. Best-effort and rate-limited: `prompt: ''` never shows UI
   * — it either reissues a token from the live Google session or fails quietly,
   * in which case the user re-auths on their next Drive action.
   */
  async refreshIfStale(): Promise<void> {
    if (!this.consented || !this.configured) return;
    if (this.accessToken() && Date.now() < this.expiresAt - 5 * 60_000) return;
    if (Date.now() - this.lastResumeAttempt < 5 * 60_000) return;
    this.lastResumeAttempt = Date.now();
    try {
      await this.signIn(false);
    } catch {
      /* stays optimistically signed in; interactive re-auth on next gesture */
    }
  }

  private persist(): void {
    try {
      const session: StoredSession = {
        token: this.accessToken() ?? '',
        expiresAt: this.expiresAt,
        consented: this.consented,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* ignore */
    }
  }

  /** Reuse a live token, or silently refresh once consent has been granted. */
  async restoreSession(): Promise<void> {
    if (this.accessToken() && Date.now() < this.expiresAt - 60_000) return;
    if (!this.consented || !this.configured) return;
    // Force the first attempt regardless of the resume rate-limit.
    this.lastResumeAttempt = 0;
    await this.refreshIfStale();
  }

  /** Wait for the GIS script, then build the token client exactly once. */
  private initClient(): Promise<void> {
    if (this.tokenClient) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const started = Date.now();
      const ready = () => {
        if (typeof google !== 'undefined' && google.accounts?.oauth2) {
          this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: environment.googleClientId,
            scope: SCOPES,
            callback: (resp: any) => {
              if (resp?.access_token) {
                this.accessToken.set(resp.access_token);
                this.isSignedIn.set(true);
                this.hasLiveToken.set(true);
                this.expiresAt =
                  Date.now() + (Number(resp.expires_in) || 3600) * 1000;
                this.consented = true;
                this.persist();
                this.scheduleProactiveRefresh();
                this.pendingResolve?.(resp.access_token);
              } else {
                this.pendingReject?.(new Error('Authorization was cancelled.'));
              }
              this.pendingResolve = null;
              this.pendingReject = null;
            },
            error_callback: (err: any) => {
              this.pendingReject?.(
                new Error(err?.message || 'Google sign-in failed.')
              );
              this.pendingResolve = null;
              this.pendingReject = null;
            },
          });
          resolve();
        } else if (Date.now() - started > 10_000) {
          reject(new Error('Google Identity Services script failed to load.'));
        } else {
          setTimeout(ready, 100);
        }
      };
      ready();
    });
  }

  /** Interactive sign-in, or a silent refresh once consent exists. */
  async signIn(interactive = true): Promise<string> {
    if (!this.configured) {
      throw new Error(
        'No Google Client ID set. Add it in src/environments/environment.ts.'
      );
    }
    if (this.inFlight) return this.inFlight;

    await this.initClient();
    this.inFlight = new Promise<string>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      // '' lets Google skip the consent screen once it has already been granted.
      const prompt = interactive && !this.consented ? 'consent' : '';
      this.tokenClient.requestAccessToken({ prompt });
    }).finally(() => {
      this.inFlight = null;
    }) as Promise<string>;

    return this.inFlight;
  }

  /** A token good for at least another minute, refreshing if it isn't. */
  async getValidToken(): Promise<string> {
    const token = this.accessToken();
    if (token && Date.now() < this.expiresAt - 60_000) return token;
    try {
      return await this.signIn(false);
    } catch (err) {
      // Silent refresh failed. If we still hold a stale token, hand it back so
      // the request can 401 and escalate to interactive; otherwise propagate.
      if (token) return token;
      throw err;
    }
  }

  signOut(): void {
    const token = this.accessToken();
    if (token && typeof google !== 'undefined') {
      try {
        google.accounts.oauth2.revoke(token, () => {});
      } catch {
        /* ignore */
      }
    }
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    this.accessToken.set(null);
    this.isSignedIn.set(false);
    this.hasLiveToken.set(false);
    this.expiresAt = 0;
    this.consented = false;
    this.lastResumeAttempt = 0;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
