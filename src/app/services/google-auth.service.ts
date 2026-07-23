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
  readonly isSignedIn = signal(false);

  constructor() {
    this.restoreFromStorage();
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

  /** Reuse a live token, or silently refresh once consent has been granted. */
  async restoreSession(): Promise<void> {
    if (this.accessToken() && Date.now() < this.expiresAt - 60_000) return;
    if (!this.consented || !this.configured) return;
    try {
      await this.signIn(false);
    } catch {
      /* no active Google session — the user can sign in by hand */
    }
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
    return this.signIn(false);
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
    this.expiresAt = 0;
    this.consented = false;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}
