/* ───────────────────────────────────────────────────────────────────────────
   A small MP4 / M4B reader: chapter markers, tags and cover art.

   An .m4b is an ISO base-media file — a tree of boxes ("atoms"). Everything we
   want lives in `moov`, which is usually a few hundred kilobytes, so we walk
   the top-level boxes with HTTP range requests and pull down `moov` alone
   rather than the whole audiobook. A 400 MB book costs us a couple of small
   reads.

   Chapters get stored two different ways in the wild, and we read both:

     • `moov/udta/chpl` — Nero-style: a flat list of (start, title). Free for us
       because it's already inside the `moov` we fetched.
     • A QuickTime *chapter track* — a `text` track whose samples are the titles
       and whose sample table gives the times. Standard, but the titles live out
       in `mdat`, so it costs one more ranged read.

   We prefer `chpl` when it's plausible and fall back to the text track, which
   keeps the common case to zero extra requests without losing files that only
   carry one of the two.
   ─────────────────────────────────────────────────────────────────────────── */

export interface Mp4Chapter {
  title: string;
  /** Seconds from the start of the file. */
  start: number;
}

export interface Mp4Meta {
  /** Seconds. 0 when the header didn't say. */
  duration: number;
  chapters: Mp4Chapter[];
  title?: string;
  author?: string;
  album?: string;
  /** `data:` URL built from an embedded `covr` image, when there is one. */
  coverDataUrl?: string;
}

/** Fetch bytes `[start, endInclusive]` of the file. */
export type RangeFetch = (start: number, endInclusive: number) => Promise<Uint8Array>;

/** How much to read when probing for top-level boxes. */
const PROBE = 128 * 1024;
/** Refuse to pull down an absurd `moov` — something is wrong with the file. */
const MAX_MOOV = 24 * 1024 * 1024;
/** A book with more markers than this is a parse gone wrong, not a book. */
const MAX_CHAPTERS = 5000;

// ── box plumbing ───────────────────────────────────────────────────────────
interface Box {
  type: string;
  /** Bytes of header (8, or 16 for a 64-bit size). */
  headerSize: number;
  /** Total size including the header. */
  size: number;
}

function boxType(buf: Uint8Array, off: number): string {
  return String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3]);
}

function readHeader(buf: Uint8Array, off: number, limit: number): Box | null {
  if (off + 8 > buf.length) return null;
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let size = dv.getUint32(off);
  const type = boxType(buf, off + 4);
  let headerSize = 8;

  if (size === 1) {
    if (off + 16 > buf.length) return null;
    // 64-bit size. Real files stay well inside JS's safe integer range.
    size = dv.getUint32(off + 8) * 2 ** 32 + dv.getUint32(off + 12);
    headerSize = 16;
  } else if (size === 0) {
    // "Runs to the end of the enclosing box."
    size = limit - off;
  }

  if (size < headerSize) return null;
  return { type, headerSize, size };
}

/** Walk the immediate children of a box body. */
function* children(buf: Uint8Array): Generator<{ type: string; body: Uint8Array }> {
  let off = 0;
  while (off + 8 <= buf.length) {
    const box = readHeader(buf, off, buf.length);
    if (!box || off + box.size > buf.length) return;
    yield { type: box.type, body: buf.subarray(off + box.headerSize, off + box.size) };
    off += box.size;
  }
}

function child(buf: Uint8Array | null, type: string): Uint8Array | null {
  if (!buf) return null;
  for (const c of children(buf)) if (c.type === type) return c.body;
  return null;
}

/** Follow a path of box types, e.g. path(moov, 'mdia', 'minf', 'stbl'). */
function path(buf: Uint8Array | null, ...types: string[]): Uint8Array | null {
  let cur = buf;
  for (const t of types) cur = child(cur, t);
  return cur;
}

function view(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Decode text that may be UTF-16 (BOM-prefixed, as QuickTime allows) or UTF-8. */
function decodeText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  }
  return new TextDecoder('utf-8').decode(bytes).replace(/\0+$/, '');
}

// ── finding moov ───────────────────────────────────────────────────────────
/**
 * Locate `moov` among the top-level boxes and return its body. `moov` sits
 * before `mdat` in a web-optimised file and after it otherwise, so we hop from
 * box header to box header rather than reading through the audio.
 */
async function readMoov(
  fetchRange: RangeFetch,
  fileSize: number
): Promise<Uint8Array | null> {
  let cursor = 0;

  for (let hop = 0; hop < 12 && cursor < fileSize; hop++) {
    const buf = await fetchRange(cursor, Math.min(fileSize - 1, cursor + PROBE - 1));
    if (buf.length < 8) return null;

    let off = 0;
    let nextCursor = -1;

    while (off + 8 <= buf.length) {
      const box = readHeader(buf, off, buf.length);
      if (!box) break;

      if (box.type === 'moov') {
        const absolute = cursor + off;
        if (off + box.size <= buf.length) {
          return buf.slice(off + box.headerSize, off + box.size);
        }
        if (box.size > MAX_MOOV) return null;
        return fetchRange(absolute + box.headerSize, absolute + box.size - 1);
      }

      const nextOff = off + box.size;
      if (nextOff <= off) return null; // malformed: no forward progress
      if (nextOff + 8 > buf.length) {
        nextCursor = cursor + nextOff;
        break;
      }
      off = nextOff;
    }

    if (nextCursor < 0) {
      // Ran out of buffer mid-walk without a box boundary to jump to.
      if (off === 0) return null;
      nextCursor = cursor + off;
    }
    cursor = nextCursor;
  }
  return null;
}

// ── mvhd: how long is the book ─────────────────────────────────────────────
function readDuration(moov: Uint8Array): number {
  const mvhd = child(moov, 'mvhd');
  if (!mvhd || mvhd.length < 20) return 0;
  const dv = view(mvhd);
  const version = mvhd[0];
  try {
    if (version === 1) {
      if (mvhd.length < 32) return 0;
      const timescale = dv.getUint32(20);
      const duration = dv.getUint32(24) * 2 ** 32 + dv.getUint32(28);
      return timescale > 0 ? duration / timescale : 0;
    }
    const timescale = dv.getUint32(12);
    const duration = dv.getUint32(16);
    return timescale > 0 ? duration / timescale : 0;
  } catch {
    return 0;
  }
}

// ── chpl: Nero-style chapter list ──────────────────────────────────────────
/**
 * `chpl` layout: version(1) flags(3), a spare uint32 when version is non-zero,
 * a one-byte count, then entries of (uint64 start in 100 ns units, uint8 title
 * length, title bytes).
 */
function readChpl(moov: Uint8Array): Mp4Chapter[] {
  const chpl = path(moov, 'udta', 'chpl');
  if (!chpl || chpl.length < 5) return [];

  const dv = view(chpl);
  let off = 0;
  const version = chpl[off];
  off += 4; // version + flags
  if (version !== 0) off += 4;
  if (off >= chpl.length) return [];

  const count = chpl[off];
  off += 1;

  const out: Mp4Chapter[] = [];
  for (let i = 0; i < count && off + 9 <= chpl.length; i++) {
    const start = (dv.getUint32(off) * 2 ** 32 + dv.getUint32(off + 4)) / 10_000_000;
    off += 8;
    const len = chpl[off];
    off += 1;
    if (off + len > chpl.length) break;
    const title = decodeText(chpl.subarray(off, off + len)).trim();
    off += len;
    out.push({ title, start: Math.max(0, start) });
  }
  return out;
}

// ── QuickTime chapter track ────────────────────────────────────────────────
interface SampleTable {
  timescale: number;
  /** Start time of each sample, in the track's timescale. */
  starts: number[];
  /** Absolute file offset of each sample. */
  offsets: number[];
  sizes: number[];
}

function readSampleTable(trak: Uint8Array): SampleTable | null {
  const mdia = child(trak, 'mdia');
  const mdhd = child(mdia, 'mdhd');
  const stbl = path(mdia, 'minf', 'stbl');
  if (!mdhd || !stbl) return null;

  const timescale =
    mdhd[0] === 1 ? view(mdhd).getUint32(20) : view(mdhd).getUint32(12);
  if (!timescale) return null;

  const stts = child(stbl, 'stts');
  const stsz = child(stbl, 'stsz');
  const stsc = child(stbl, 'stsc');
  const stco = child(stbl, 'stco');
  const co64 = child(stbl, 'co64');
  if (!stts || !stsz || !stsc || (!stco && !co64)) return null;

  // Sample sizes.
  const zv = view(stsz);
  const uniformSize = zv.getUint32(4);
  const sampleCount = zv.getUint32(8);
  if (sampleCount === 0 || sampleCount > MAX_CHAPTERS) return null;

  const sizes: number[] = [];
  for (let i = 0; i < sampleCount; i++) {
    sizes.push(uniformSize > 0 ? uniformSize : zv.getUint32(12 + i * 4));
  }

  // Sample start times, decoded from the run-length delta table.
  const tv = view(stts);
  const sttsEntries = tv.getUint32(4);
  const starts: number[] = [];
  let clock = 0;
  for (let e = 0; e < sttsEntries && starts.length < sampleCount; e++) {
    const runs = tv.getUint32(8 + e * 8);
    const delta = tv.getUint32(12 + e * 8);
    for (let i = 0; i < runs && starts.length < sampleCount; i++) {
      starts.push(clock);
      clock += delta;
    }
  }
  while (starts.length < sampleCount) starts.push(clock);

  // Chunk offsets.
  const chunks: number[] = [];
  if (co64) {
    const cv = view(co64);
    const n = cv.getUint32(4);
    for (let i = 0; i < n; i++) {
      chunks.push(cv.getUint32(8 + i * 8) * 2 ** 32 + cv.getUint32(12 + i * 8));
    }
  } else {
    const cv = view(stco!);
    const n = cv.getUint32(4);
    for (let i = 0; i < n; i++) chunks.push(cv.getUint32(8 + i * 4));
  }
  if (!chunks.length) return null;

  // Sample-to-chunk runs.
  const sv = view(stsc);
  const scEntries = sv.getUint32(4);
  const runs: { firstChunk: number; perChunk: number }[] = [];
  for (let i = 0; i < scEntries; i++) {
    runs.push({
      firstChunk: sv.getUint32(8 + i * 12),
      perChunk: sv.getUint32(12 + i * 12),
    });
  }
  if (!runs.length) return null;

  const perChunkFor = (chunkNumber: number): number => {
    let n = runs[0].perChunk;
    for (const r of runs) {
      if (r.firstChunk <= chunkNumber) n = r.perChunk;
      else break;
    }
    return Math.max(1, n);
  };

  // Lay the samples out inside their chunks.
  const offsets: number[] = [];
  let sample = 0;
  for (let c = 0; c < chunks.length && sample < sampleCount; c++) {
    const perChunk = perChunkFor(c + 1);
    let pos = chunks[c];
    for (let k = 0; k < perChunk && sample < sampleCount; k++) {
      offsets.push(pos);
      pos += sizes[sample];
      sample++;
    }
  }
  if (offsets.length < sampleCount) return null;

  return { timescale, starts, offsets, sizes };
}

/** Find the `text`/`sbtl` track — the one holding chapter titles. */
function findChapterTrack(moov: Uint8Array): SampleTable | null {
  for (const c of children(moov)) {
    if (c.type !== 'trak') continue;
    const hdlr = path(c.body, 'mdia', 'hdlr');
    if (!hdlr || hdlr.length < 12) continue;
    const handler = boxType(hdlr, 8);
    if (handler !== 'text' && handler !== 'sbtl') continue;
    const table = readSampleTable(c.body);
    if (table) return table;
  }
  return null;
}

/**
 * Read the titles out of `mdat`. A text sample is a uint16 length followed by
 * the characters, so one ranged read over the span covers every chapter name.
 */
async function readChapterTrack(
  moov: Uint8Array,
  fetchRange: RangeFetch
): Promise<Mp4Chapter[]> {
  const table = findChapterTrack(moov);
  if (!table) return [];

  const first = Math.min(...table.offsets);
  const last = Math.max(
    ...table.offsets.map((o, i) => o + (table.sizes[i] ?? 0))
  );
  if (!isFinite(first) || !isFinite(last) || last <= first) return [];
  // Chapter titles are tiny; anything huge means we mis-read the tables.
  if (last - first > 4 * 1024 * 1024) return [];

  const blob = await fetchRange(first, last - 1);
  const out: Mp4Chapter[] = [];

  for (let i = 0; i < table.offsets.length; i++) {
    const at = table.offsets[i] - first;
    const size = table.sizes[i];
    if (at < 0 || at + size > blob.length || size < 2) continue;
    const textLen = view(blob).getUint16(at);
    const end = Math.min(at + 2 + textLen, at + size);
    const title = decodeText(blob.subarray(at + 2, end)).trim();
    out.push({ title, start: table.starts[i] / table.timescale });
  }
  return out;
}

// ── iTunes tags ────────────────────────────────────────────────────────────
function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000; // chunked, or a big cover blows the argument limit
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

/**
 * `moov/udta/meta/ilst` holds the iTunes tags. Each item is a box named after
 * the tag, wrapping a `data` box: uint32 type indicator, uint32 locale, payload.
 */
function readTags(moov: Uint8Array): Partial<Mp4Meta> {
  const meta = path(moov, 'udta', 'meta');
  // `meta` is a full box: skip its version/flags before the children start.
  const ilst = meta && meta.length > 4 ? child(meta.subarray(4), 'ilst') : null;
  if (!ilst) return {};

  const out: Partial<Mp4Meta> = {};
  for (const item of children(ilst)) {
    const data = child(item.body, 'data');
    if (!data || data.length < 8) continue;
    const indicator = view(data).getUint32(0) & 0x00ffffff;
    const payload = data.subarray(8);

    switch (item.type) {
      case '©nam':
        out.title = decodeText(payload).trim() || undefined;
        break;
      case '©ART':
      case 'aART':
        out.author ??= decodeText(payload).trim() || undefined;
        break;
      case '©alb':
        out.album = decodeText(payload).trim() || undefined;
        break;
      case 'covr': {
        // 13 = JPEG, 14 = PNG; anything else we leave alone.
        const mime =
          indicator === 14 ? 'image/png' : indicator === 13 ? 'image/jpeg' : '';
        // Keep covers small enough to live in local storage.
        if (mime && payload.length > 0 && payload.length < 700_000) {
          out.coverDataUrl = `data:${mime};base64,${bytesToBase64(payload)}`;
        }
        break;
      }
    }
  }
  return out;
}

// ── the one exported entry point ───────────────────────────────────────────
/**
 * Read what an .m4b/.mp4 can tell us about itself. Returns null when the file
 * isn't a readable ISO base-media file — callers should fall back to treating
 * it as a single opaque chapter.
 */
export async function readMp4Meta(
  fetchRange: RangeFetch,
  fileSize: number
): Promise<Mp4Meta | null> {
  const moov = await readMoov(fetchRange, fileSize);
  if (!moov) return null;

  const duration = readDuration(moov);
  const tags = readTags(moov);

  // `chpl` costs nothing — it came down inside `moov`. A lone entry is usually
  // a placeholder at 0:00 rather than a real chapter list, so it doesn't count.
  let chapters = readChpl(moov);
  if (chapters.length < 2) {
    try {
      const fromTrack = await readChapterTrack(moov, fetchRange);
      if (fromTrack.length > chapters.length) chapters = fromTrack;
    } catch {
      /* the text track is a bonus, not a requirement */
    }
  }

  chapters = chapters
    .filter((c) => isFinite(c.start) && c.start >= 0)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_CHAPTERS);

  // Drop markers past the end of the audio — some taggers leave strays.
  if (duration > 0) chapters = chapters.filter((c) => c.start < duration - 0.5);

  return { duration, chapters, ...tags };
}
