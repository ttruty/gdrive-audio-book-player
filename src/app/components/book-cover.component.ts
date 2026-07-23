import { Component, computed, inject, input } from '@angular/core';
import { CrestService } from '../services/crest.service';
import { LibraryService } from '../services/library.service';

/**
 * A book's face: the real cover if Drive had one in the folder, otherwise a
 * hand-painted flag derived from the book id. An optional brass arc around the
 * edge shows how far in the listener is.
 */
@Component({
  selector: 'app-cover',
  standalone: true,
  template: `
    <div
      class="cover"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.background]="art() ? 'transparent' : gradient()"
      [style.--r]="radius() + 'px'"
    >
      @if (art(); as src) {
        <img [src]="src" [alt]="title()" />
      } @else {
        <span
          class="glyph"
          [class.letter]="isLetter()"
          [style.font-size.px]="size() * (isLetter() ? 0.44 : 0.42)"
          >{{ glyph() }}</span
        >
      }

      @if (progress() > 0) {
        <div class="bar"><span [style.width.%]="progress() * 100"></span></div>
      }

      @if (finished()) {
        <div class="stamp" [style.font-size.px]="size() * 0.2">✔</div>
      }
    </div>
  `,
  styles: [
    `
      /* The skin can override the corner via --yb-cover-radius; otherwise it
         scales with the tile, which is what the pirate look wants. */
      .cover {
        position: relative;
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        overflow: hidden;
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.28);
        border: 1px solid var(--yb-rope);
        border-radius: var(--yb-cover-radius, var(--r));
      }
      img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        border-radius: inherit;
      }
      .glyph {
        line-height: 1;
        filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.45));
      }
      .glyph.letter {
        font-weight: 700;
        color: rgba(255, 255, 255, 0.92);
        filter: none;
        letter-spacing: -0.02em;
      }
      .bar {
        position: absolute;
        left: 6%;
        right: 6%;
        bottom: 6%;
        height: 3px;
        border-radius: 2px;
        background: rgba(0, 0, 0, 0.45);
        overflow: hidden;
      }
      .bar > span {
        display: block;
        height: 100%;
        background: var(--ion-color-primary);
      }
      .stamp {
        position: absolute;
        top: 5%;
        right: 6%;
        width: 1.5em;
        height: 1.5em;
        display: grid;
        place-items: center;
        border-radius: 50%;
        color: #12210f;
        background: var(--ion-color-primary);
        font-weight: 700;
      }
    `,
  ],
})
export class BookCoverComponent {
  private crest = inject(CrestService);
  private library = inject(LibraryService);

  readonly bookId = input.required<string>();
  readonly title = input('');
  readonly size = input(56);
  /** 0–1; pass 0 to hide the bar. */
  readonly progress = input(0);
  readonly finished = input(false);

  readonly radius = computed(() => Math.max(6, Math.round(this.size() * 0.11)));
  readonly art = computed(() => this.library.cover(this.bookId()));
  readonly gradient = computed(() => this.crest.gradient(this.bookId()));
  readonly glyph = computed(() => this.crest.glyph(this.bookId(), this.title()));
  readonly isLetter = computed(() => this.crest.glyphIsLetter());
}
