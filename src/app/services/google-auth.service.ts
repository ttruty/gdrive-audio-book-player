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

  readonly accessToken = signal<string | null>(null);
  /**
   * Whether the user has a standing Google connection. True while a live token
   * is held AND while consent stands but the token has merely lapsed — in the
   * latter case the app stays usable (library visible) and re-authorizes only
   * when the user next does a Drive action, rather than at launch.
   */
  readonly isSignedIn = signal(false);
  /** True only when a usable (unexpired) access token is in hand. */
  readonly hasLiveToken = signal(false);

  constructor() {
    this.restoreFromStorage();
  }

  get configured(): boolean {
    const id = environment.googleClientId;
    return !!id && !id.includes('PASTE');
  }

  /**
   * Google's token popup can only open in response to a user gesture. We also
   * use this to refuse acquiring a token *without* one — so the app never
   * surfaces a Google prompt on its own (at launch, during background sync,
   * etc.). Requesting a token silently isn't reliable across browsers: when
   * third-party cookies to accounts.google.com are blocked (Safari always,
   * Chrome increasingly) the "silent" flow falls back to showing UI, which is
   * exactly the every-launch prompt we want to avoid.
   */
  private hasUserGesture(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      !!(navigator as unknown as { userActivation?: { isActive: boolean } })
        .userActivation?.isActive
    );
  }

  private restoreFromStorage(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as StoredSession;
      this.consented = !!s.consented;
      if (s.token && Date.now() < s.expiresAt - 60_000) {
        // A still-valid token: fully signed in, no prompt needed. Relaunching
        // within the token's ~1-hour life reuses this and never asks Google.
        this.accessToken.set(s.token);
        this.expiresAt = s.expiresAt;
        this.isSignedIn.set(true);
        this.hasLiveToken.set(true);
      } else if (this.consented && this.configured) {
        // Consent stands but the token has lapsed. Keep the user signed in so
        // they see their library; re-authorize only when they next tap a Drive
        // action (which carries the gesture Google's popup needs). Nothing is
        // requested automatically here — that's what caused the launch prompt.
        this.isSignedIn.set(true);
      }
    } catch {
      /* corrupt/unavailable storage — sail on signed out */
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

  /**
   * Called on app startup. Intentionally does nothing beyond what the
   * constructor already did (load a still-valid stored token): the app must
   * never trigger Google's auth flow on its own, or browsers that can't refresh
   * silently would prompt on every launch. Re-authorization happens lazily,
   * on the user's next Drive action.
   */
  async restoreSession(): Promise<void> {
    /* no automatic token acquisition — see hasUserGesture() */
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

  /**
   * Request a token from Google. Opens the popup/flow, so it MUST be reached
   * from a user gesture. `interactive` only affects whether we ask for the
   * consent screen the very first time; once consent is granted, `prompt` is
   * empty so returning users aren't asked to re-consent.
   */
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

  /**
   * A token for a Drive call. Returns the live token if there is one. If it has
   * lapsed, a new one is fetched ONLY when the caller is running inside a user
   * gesture — so background work (startup sync, read-ahead) never pops a Google
   * prompt on its own. Without a gesture it hands back the stale token (letting
   * the request 401 harmlessly) or throws when there's nothing to hand back.
   */
  async getValidToken(): Promise<string> {
    const token = this.accessToken();
    if (token && Date.now() < this.expiresAt - 60_000) return token;

    if (!this.hasUserGesture()) {
      if (token) return token;
      throw new Error('Google authorization needed — open a Drive book to sign in.');
    }
    try {
      return await this.signIn(false);
    } catch (err) {
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
    this.accessToken.set(null);
    this.isSignedIn.set(false);
    this.hasLiveToken.set(false);
    this.expiresAt = 0;
    this.consented = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
