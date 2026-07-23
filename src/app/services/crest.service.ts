import { Injectable, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

export interface Crest {
  /** 0–359. */
  hue: number;
  glyph: string;
}

const STORAGE_KEY = 'yarnbeard.crests.v1';

/** Every book without a cover gets a flag. These are the flags. */
export const CREST_GLYPHS = [
  '🏴‍☠️', '☠️', '⚓️', '🧭', '🗺️', '🦜', '🐙', '🐋',
  '⛵️', '🚢', '🔱', '⚔️', '🗝️', '💰', '🍾', '🕯️',
  '🐊', '🦈', '🌊', '🌪️', '🌘', '🧜', '🪝', '📜',
];

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Deterministic cover art for books Drive gave us no image for: a hand-painted
 * flag, stable across reloads because it's derived from the book id.
 */
@Injectable({ providedIn: 'root' })
export class CrestService {
  private settings = inject(SettingsService);
  private overrides = signal<Record<string, Crest>>(this.read());
  private urlCache = new Map<string, string>();

  private get studio(): boolean {
    return this.settings.skin() === 'studio';
  }

  private read(): Record<string, Crest> {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as Record<string, Crest>) : {};
    } catch {
      return {};
    }
  }

  private write(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.overrides()));
    } catch {
      /* ignore */
    }
  }

  private generate(seed: string): Crest {
    const h = hashStr(seed);
    return {
      // Bias toward sea/brass hues rather than the whole rainbow.
      hue: [190, 205, 172, 38, 24, 342, 268, 152][h % 8] + ((h >>> 5) % 18),
      glyph: CREST_GLYPHS[(h >>> 9) % CREST_GLYPHS.length],
    };
  }

  resolve(seed: string): Crest {
    return this.overrides()[seed] ?? this.generate(seed);
  }

  /** CSS for the tile behind the glyph. */
  gradient(seed: string): string {
    const c = this.resolve(seed);
    if (this.studio) {
      // Flatter and more saturated — a record-sleeve block, not a weathered flag.
      return `linear-gradient(135deg, hsl(${c.hue} 58% 42%), hsl(${
        (c.hue + 28) % 360
      } 62% 26%))`;
    }
    return `linear-gradient(150deg, hsl(${c.hue} 44% 30%), hsl(${
      (c.hue + 40) % 360
    } 52% 16%))`;
  }

  /**
   * The mark on a coverless book: a pirate flag under sail, or the title's
   * initial in the studio skin, where an emoji would look like a mistake.
   */
  glyph(seed: string, title = ''): string {
    if (this.studio) {
      const letter = title.match(/\p{L}|\p{N}/u)?.[0];
      return letter ? letter.toUpperCase() : '♪';
    }
    return this.resolve(seed).glyph;
  }

  /** Whether the glyph should be set in the UI font rather than as an emoji. */
  glyphIsLetter(): boolean {
    return this.studio;
  }

  set(seed: string, crest: Crest): void {
    this.overrides.update((o) => ({ ...o, [seed]: crest }));
    this.write();
    this.urlCache.clear();
  }

  /** Roll a new flag for this book. */
  reroll(seed: string): Crest {
    const crest: Crest = {
      hue: Math.floor(Math.random() * 360),
      glyph: CREST_GLYPHS[Math.floor(Math.random() * CREST_GLYPHS.length)],
    };
    this.set(seed, crest);
    return crest;
  }

  reset(seed: string): void {
    this.overrides.update((o) => {
      const next = { ...o };
      delete next[seed];
      return next;
    });
    this.write();
    this.urlCache.clear();
  }

  /** PNG data URL, for the lock-screen artwork when there's no real cover. */
  dataUrl(seed: string, size = 512, title = ''): string {
    const c = this.resolve(seed);
    const studio = this.studio;
    const glyph = this.glyph(seed, title);
    const key = `${seed}|${c.hue}|${glyph}|${size}|${studio ? 's' : 'p'}`;
    const hit = this.urlCache.get(key);
    if (hit) return hit;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';

      const grad = ctx.createLinearGradient(0, 0, size, size);
      if (studio) {
        grad.addColorStop(0, `hsl(${c.hue}, 58%, 42%)`);
        grad.addColorStop(1, `hsl(${(c.hue + 28) % 360}, 62%, 26%)`);
      } else {
        grad.addColorStop(0, `hsl(${c.hue}, 44%, 30%)`);
        grad.addColorStop(1, `hsl(${(c.hue + 40) % 360}, 52%, 16%)`);
      }
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, size, size);

      if (!studio) {
        // A brass hairline border, like a framed chart.
        ctx.strokeStyle = 'rgba(217, 164, 65, 0.5)';
        ctx.lineWidth = Math.max(2, size * 0.012);
        const inset = size * 0.05;
        ctx.strokeRect(inset, inset, size - inset * 2, size - inset * 2);
      }

      ctx.font = studio
        ? `700 ${Math.round(size * 0.44)}px -apple-system, "Segoe UI", Roboto, sans-serif`
        : `${Math.round(size * 0.46)}px "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
      ctx.fillStyle = studio ? 'rgba(255, 255, 255, 0.92)' : '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, size / 2, size * (studio ? 0.52 : 0.54));

      const url = canvas.toDataURL('image/png');
      this.urlCache.set(key, url);
      return url;
    } catch {
      return '';
    }
  }
}
