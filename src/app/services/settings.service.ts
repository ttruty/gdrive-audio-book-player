import { Injectable, effect, signal } from '@angular/core';

export type ThemeMode = 'system' | 'light' | 'dark';

/**
 * The look *and* the language. A green-and-charcoal player that still says
 * "Belay that" on its cancel buttons would be a costume, not a theme, so the
 * skin drives the palette, the typography and the whole vocabulary together.
 */
export type Skin = 'pirate' | 'studio';

export const SKINS: { key: Skin; name: string; blurb: string; swatch: string[] }[] = [
  {
    key: 'pirate',
    name: 'Yarnbeard',
    blurb: 'Brass, parchment and deep water. Speaks pirate.',
    swatch: ['#0d1f2b', '#d9a441', '#3d9199'],
  },
  {
    key: 'studio',
    name: 'Studio',
    blurb: 'Charcoal and green, plain language. Familiar and out of the way.',
    swatch: ['#121212', '#1db954', '#b3b3b3'],
  },
];

export const SKIP_OPTIONS = [10, 15, 20, 30, 45, 60, 90];
export const BOOST_OPTIONS = [1, 1.25, 1.5, 2, 2.5];
export const SPEED_OPTIONS = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
export const SLEEP_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90];
/** Cache ceilings in GB; 0 means no limit. */
export const CACHE_BUDGETS = [1, 2, 4, 8, 16, 0];

const STORAGE_KEY = 'yarnbeard.settings.v1';

interface Stored {
  mode: ThemeMode;
  skin: Skin;
  skipBack: number;
  skipForward: number;
  autoRewind: boolean;
  maxRewind: number;
  defaultRate: number;
  perBookRate: boolean;
  boost: number;
  skipSilence: boolean;
  enhanceVoice: boolean;
  sleepFade: boolean;
  sleepMinutes: number;
  syncToDrive: boolean;
  autoStowNext: boolean;
  keepPlayed: boolean;
  cacheBudgetGb: number;
  continuousPlay: boolean;
  keepAwake: boolean;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  /** Appearance. Skin picks the character; mode picks light or dark within it. */
  readonly mode = signal<ThemeMode>('system');
  readonly skin = signal<Skin>('pirate');

  /** Transport. */
  readonly skipBack = signal(15);
  readonly skipForward = signal(30);
  /**
   * Rewind a little when picking a book back up, scaled by how long it's been —
   * the single most useful audiobook feature there is.
   */
  readonly autoRewind = signal(true);
  readonly maxRewind = signal(30);
  readonly continuousPlay = signal(true);

  /** Sound. */
  readonly defaultRate = signal(1);
  readonly perBookRate = signal(true);
  readonly boost = signal(1);
  readonly skipSilence = signal(false);
  /**
   * Speech enhancement for rough recordings: a high-pass to drop rumble, a dip
   * in the muddy low-mids, a lift in the presence band for consonant clarity,
   * and gentle compression to even out uneven or quiet levels.
   */
  readonly enhanceVoice = signal(false);

  /** Sleep. */
  readonly sleepFade = signal(true);
  readonly sleepMinutes = signal(30);

  /** Drive + offline. */
  readonly syncToDrive = signal(true);
  readonly autoStowNext = signal(false);
  readonly keepAwake = signal(true);
  /**
   * Keep files playback already downloaded, so returning to a book you were
   * listening to yesterday starts instantly instead of fetching it again.
   */
  readonly keepPlayed = signal(true);
  /** Ceiling for auto-kept files, in GB. 0 means no limit. */
  readonly cacheBudgetGb = signal(4);

  private media =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;

  constructor() {
    this.restore();

    effect(() => {
      this.applyTheme();
      this.persist();
    });

    this.media?.addEventListener('change', () => {
      if (this.mode() === 'system') this.applyTheme();
    });
  }

  private restore(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw) as Partial<Stored>;
      const num = (v: unknown) => typeof v === 'number' && isFinite(v);
      const bool = (v: unknown) => typeof v === 'boolean';

      if (s.mode) this.mode.set(s.mode);
      if (s.skin === 'pirate' || s.skin === 'studio') this.skin.set(s.skin);
      if (num(s.skipBack)) this.skipBack.set(s.skipBack!);
      if (num(s.skipForward)) this.skipForward.set(s.skipForward!);
      if (bool(s.autoRewind)) this.autoRewind.set(s.autoRewind!);
      if (num(s.maxRewind)) this.maxRewind.set(s.maxRewind!);
      if (bool(s.continuousPlay)) this.continuousPlay.set(s.continuousPlay!);
      if (num(s.defaultRate)) this.defaultRate.set(s.defaultRate!);
      if (bool(s.perBookRate)) this.perBookRate.set(s.perBookRate!);
      if (num(s.boost)) this.boost.set(s.boost!);
      if (bool(s.skipSilence)) this.skipSilence.set(s.skipSilence!);
      if (bool(s.enhanceVoice)) this.enhanceVoice.set(s.enhanceVoice!);
      if (bool(s.sleepFade)) this.sleepFade.set(s.sleepFade!);
      if (num(s.sleepMinutes)) this.sleepMinutes.set(s.sleepMinutes!);
      if (bool(s.syncToDrive)) this.syncToDrive.set(s.syncToDrive!);
      if (bool(s.autoStowNext)) this.autoStowNext.set(s.autoStowNext!);
      if (bool(s.keepPlayed)) this.keepPlayed.set(s.keepPlayed!);
      if (num(s.cacheBudgetGb)) this.cacheBudgetGb.set(s.cacheBudgetGb!);
      if (bool(s.keepAwake)) this.keepAwake.set(s.keepAwake!);
    } catch {
      /* ignore */
    }
  }

  private persist(): void {
    try {
      const data: Stored = {
        mode: this.mode(),
        skin: this.skin(),
        skipBack: this.skipBack(),
        skipForward: this.skipForward(),
        autoRewind: this.autoRewind(),
        maxRewind: this.maxRewind(),
        continuousPlay: this.continuousPlay(),
        defaultRate: this.defaultRate(),
        perBookRate: this.perBookRate(),
        boost: this.boost(),
        skipSilence: this.skipSilence(),
        enhanceVoice: this.enhanceVoice(),
        sleepFade: this.sleepFade(),
        sleepMinutes: this.sleepMinutes(),
        syncToDrive: this.syncToDrive(),
        autoStowNext: this.autoStowNext(),
        keepPlayed: this.keepPlayed(),
        cacheBudgetGb: this.cacheBudgetGb(),
        keepAwake: this.keepAwake(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      /* ignore */
    }
  }

  private applyTheme(): void {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const mode = this.mode();
    const skin = this.skin();
    const dark = mode === 'system' ? !!this.media?.matches : mode === 'dark';

    root.classList.toggle('ion-palette-dark', dark);
    root.classList.toggle('yb-skin-pirate', skin === 'pirate');
    root.classList.toggle('yb-skin-studio', skin === 'studio');

    const bar: Record<Skin, [string, string]> = {
      // [light, dark] — matches the toolbar colour of each skin.
      pirate: ['#e8d9b6', '#0d1f2b'],
      studio: ['#ffffff', '#121212'],
    };
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', bar[skin][dark ? 1 : 0]);
  }

  /**
   * How far to rewind when resuming, given how long the book sat idle.
   * A minute away needs no rewind; a week away wants the full backup.
   */
  rewindFor(idleMs: number): number {
    if (!this.autoRewind()) return 0;
    const max = this.maxRewind();
    const mins = idleMs / 60_000;
    if (mins < 1) return 0;
    if (mins < 10) return Math.min(5, max);
    if (mins < 60) return Math.min(10, max);
    if (mins < 60 * 24) return Math.min(20, max);
    return max;
  }
}
