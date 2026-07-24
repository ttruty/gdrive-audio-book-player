/* ───────────────────────────────────────────────────────────────────────────
   Yarnbeard's domain.

   A *book* comes in two shapes, and the app plays both the same way:

     • **file** — one .m4b/.mp4/.mp3 that is the whole audiobook. Its chapters
       are the marker positions embedded in the file, so a "chapter" is a
       time window inside a single Drive file.
     • **folder** — a Drive folder whose audio files are the chapters, one
       file each, in natural filename order.

   Everything the app remembers about a book (where you stopped, what you
   marked, what you wrote) is keyed by the book's Drive id — a file id for the
   first shape, a folder id for the second — so it survives re-scans and follows
   the book across devices once Drive sync is on.
   ─────────────────────────────────────────────────────────────────────────── */

export interface Chapter {
  /**
   * Stable identity for progress and bookmarks. For a folder book this is the
   * Drive file id; for an embedded chapter it's `<fileId>#<index>`.
   */
  id: string;
  /** The Drive file holding this chapter's audio. */
  fileId: string;
  /** Raw filename, e.g. "03 - The Black Spot.mp3". */
  name: string;
  /** Display title: an embedded marker name, or the filename tidied up. */
  title: string;
  /** Position in the book, 0-based. */
  index: number;
  mimeType?: string;
  /** Bytes of the underlying file, when Drive reported it. */
  size?: number;
  /**
   * Seconds. Known up front for embedded chapters; for folder books it is only
   * measured once the chapter has played, so treat 0/undefined as "not yet".
   */
  duration?: number;
  /**
   * Seconds into `fileId` where this chapter begins. Absent (or 0) means the
   * chapter starts at the top of its own file.
   */
  start?: number;
  /** Seconds into `fileId` where it ends. Absent means "to the end of the file". */
  end?: number;
}

export interface Book {
  /** Drive file id (a single-file book) or folder id (a folder of chapters). */
  id: string;
  /** Which shape this book is. Older records without it are folder books. */
  kind?: 'file' | 'folder';
  /**
   * Where the audio comes from. `drive` (the default) fetches from Google
   * Drive; `local` was imported from the device and lives only in this
   * browser's cache — it needs no sign-in and never syncs to Drive.
   */
  source?: 'drive' | 'local';
  /** Editable title; defaults to an embedded tag, else the file/folder name. */
  title: string;
  /** Name as it exists in Drive (kept for re-sync and display hints). */
  folderName: string;
  /** Editable; from an embedded artist tag or an "Author - Title" name. */
  author?: string;
  chapters: Chapter[];
  /** Drive file id of a cover image found alongside the audio, if any. */
  coverFileId?: string;
  /** True when the chapter list came from markers inside the file. */
  embeddedChapters?: boolean;
  /** Millis. */
  addedAt: number;
  /** Millis — last time the chapter list was pulled from Drive. */
  refreshedAt?: number;
  /** Free-text tags the user adds ("fantasy", "re-read", …). */
  tags?: string[];
}

/** Where the listener left off, per book. */
export interface BookProgress {
  bookId: string;
  chapterIndex: number;
  /** Seconds into the current chapter. */
  position: number;
  /** Chapter id → measured duration in seconds. */
  durations: Record<string, number>;
  /** Chapter ids the listener has played to the end. */
  completed: string[];
  updatedAt: number;
  /** Set when the listener marks the whole book done (or finishes the last chapter). */
  finishedAt?: number;
  /** Total seconds of audio actually listened to, across all sessions. */
  listened: number;
}

/** "X marks the spot" — a saved position in a book. */
export interface Bookmark {
  id: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  /** Seconds into the chapter. */
  position: number;
  label: string;
  createdAt: number;
}

/** A Cap'n's Log entry — a note pinned to a moment in a book. */
export interface Note {
  id: string;
  bookId: string;
  chapterId: string;
  chapterIndex: number;
  position: number;
  text: string;
  createdAt: number;
  updatedAt: number;
}

/** A saved Drive folder, re-scanned on pull-to-refresh. */
export interface Shelf {
  id: string;
  name: string;
  folderId: string;
  /**
   * How the folder was read: `files` means each audio file inside is its own
   * book, `folder` means each subfolder is a book of numbered chapters.
   * Absent on shelves saved before the choice existed — those were `folder`.
   */
  mode?: 'files' | 'folder';
  addedAt: number;
}

/** One day's listening, for the logbook stats. */
export interface DayStat {
  /** "YYYY-MM-DD" in local time. */
  date: string;
  seconds: number;
}

/**
 * A single listening session — a continuous stretch of one book. Recorded so
 * the stats can show *what* was listened to on a given day, and for how long,
 * rather than only a daily total.
 */
export interface Session {
  id: string;
  bookId: string;
  /** Title snapshotted at record time, so it survives the book being removed. */
  bookTitle: string;
  /** "YYYY-MM-DD" (local) of when the session started. */
  date: string;
  /** Millis. */
  startedAt: number;
  endedAt: number;
  /** Seconds of audio actually heard in this session. */
  seconds: number;
}

/** The whole synced library payload — what lives in Drive's appDataFolder. */
export interface LibrarySnapshot {
  app: 'yarnbeard';
  version: 1;
  updatedAt: number;
  books: Book[];
  shelves: Shelf[];
  progress: Record<string, BookProgress>;
  bookmarks: Bookmark[];
  notes: Note[];
  stats: DayStat[];
}

export type SortMode = 'recent' | 'title' | 'author' | 'added' | 'progress';
export type ShelfFilter = 'all' | 'reading' | 'unstarted' | 'finished';
