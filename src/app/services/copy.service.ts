import { Injectable, computed, inject } from '@angular/core';
import { SettingsService, Skin } from './settings.service';

/* ───────────────────────────────────────────────────────────────────────────
   Every word the app says, in both voices.

   The pirate skin renames the furniture — a library becomes The Hold, notes
   become the Cap'n's Log. The studio skin calls things what they are. Keeping
   both in one table makes the difference auditable at a glance and stops the
   two voices leaking into each other.
   ─────────────────────────────────────────────────────────────────────────── */

export interface Vocab {
  // ── identity ──────────────────────────────────────────────────────────
  appMark: string;
  tagline: string;

  // ── tabs & page titles ────────────────────────────────────────────────
  libraryTab: string;
  notesTab: string;
  settingsTab: string;
  playerTitle: string;

  // ── shelf ─────────────────────────────────────────────────────────────
  searchPlaceholder: string;
  filterAll: string;
  filterReading: string;
  filterUnstarted: string;
  filterFinished: string;
  continueLegend: string;
  signIn: string;
  signOut: string;
  addBook: string;
  addAnother: string;
  addSheetTitle: string;
  addSubmit: string;
  addFromDevice: string;
  addFromDeviceBlurb: string;
  orDivider: string;
  addIntro: string;
  modeFilesTitle: string;
  modeFilesBlurb: string;
  modeFolderTitle: string;
  modeFolderBlurb: string;
  foldersLegend: string;
  forget: string;
  refreshHint: string;
  pullText: string;
  pullBusy: string;
  scanStart: string;
  scanTidy: string;

  // ── empty states ──────────────────────────────────────────────────────
  welcomeGlyph: string;
  welcomeTitle: string;
  welcomeBody: string;
  emptyGlyph: string;
  emptyTitle: string;
  emptyBody: string;
  noMatchTitle: string;
  noMatchBody: string;

  // ── book status lines ─────────────────────────────────────────────────
  statusFinished: string;
  statusUnopened: (chapters: number) => string;

  // ── actions ───────────────────────────────────────────────────────────
  cancel: string;
  save: string;
  resume: string;
  start: string;
  relisten: string;
  openBook: string;
  sortHeader: string;
  renameTitle: string;
  markFinished: string;
  markUnread: string;
  rescan: string;
  editTags: string;
  newArt: string;
  removeAction: string;
  removeTitle: string;
  removeBody: (title: string) => string;
  startOver: string;
  startOverTitle: string;
  startOverBody: string;

  // ── chapters, marks, notes ────────────────────────────────────────────
  chaptersPanel: string;
  marksPanel: string;
  notesPanel: string;
  markNoun: string;
  noteNoun: string;
  addNote: string;
  noteSheetTitle: string;
  notePlaceholder: string;
  noteSubmit: string;
  noteEditTitle: string;
  markRenameTitle: string;
  noMarksTitle: string;
  noMarksBody: string;
  noMarksGlyph: string;
  noNotesTitle: string;
  noNotesBody: string;
  noNotesGlyph: string;
  exportNotes: string;
  exportHint: string;
  exportRefusedTitle: string;
  saveLocally: string;
  /** Used inside the Markdown file written to Drive. */
  exportDocTitle: string;
  exportMarksHeading: string;
  exportNotesHeading: string;
  exportEmptyLine: string;
  exportKeptBy: string;
  exportFileStem: string;
  markToast: (at: string) => string;
  noteToast: string;

  // ── offline ───────────────────────────────────────────────────────────
  stow: string;
  unstow: string;
  stowedWord: string;
  /** For files kept automatically by playback rather than chosen. */
  keptWord: string;
  stowDone: string;
  stowCleared: string;

  // ── player ────────────────────────────────────────────────────────────
  speedTitle: string;
  speedPerBook: string;
  speedPerBookBlurb: string;
  sleepTitle: string;
  sleepIntro: string;
  sleepButton: string;
  sleepChapterEnd: string;
  sleepExtend: string;
  sleepCancel: string;
  sleepStarted: (m: number) => string;
  sleepChapterToast: string;
  fadeLabel: string;
  fadeBlurb: string;
  markButton: string;
  noteButton: string;
  chaptersButton: string;
  playerEmptyGlyph: string;
  playerEmptyTitle: string;
  playerEmptyBody: string;
  toLibrary: string;

  // ── log / stats ───────────────────────────────────────────────────────
  entriesTab: string;
  marksTab: string;
  statsTab: string;
  logSearchPlaceholder: string;
  logEmptyTitle: string;
  logEmptyBody: string;
  statTotal: string;
  statStreak: string;
  statToday: string;
  statFinished: string;
  statUnderway: string;
  statNotes: string;
  chartLegend: string;
  statsNote: string;
  booksInLibrary: string;
  marksDropped: string;

  // ── settings ──────────────────────────────────────────────────────────
  sectionAccount: string;
  sectionPlayback: string;
  sectionSound: string;
  sectionSleep: string;
  sectionOffline: string;
  sectionAppearance: string;
  sectionBackup: string;
  sectionAbout: string;
  sectionInstall: string;
  installTitle: string;
  installBody: string;
  installAction: string;
  installedTitle: string;
  modeSystem: string;
  modeLight: string;
  modeDark: string;
  offlineCountLabel: string;
  emptyOffline: string;
  emptyOfflineTitle: string;
  emptyOfflineBody: (n: number) => string;
  signOutTitle: string;
  signOutBody: string;
  wipeTitle: string;
  wipeBody: string;
  wipeAction: string;
  backupExportTitle: string;
  backupImportTitle: string;
  aboutBlurb: string;
  syncedToast: string;
}

const PIRATE: Vocab = {
  appMark: '🏴‍☠️',
  tagline: 'Plunder yer audiobooks from the Google Drive seas.',

  libraryTab: 'The Hold',
  notesTab: "Cap'n's Log",
  settingsTab: 'Charts',
  playerTitle: 'The Helm',

  searchPlaceholder: 'Search the hold…',
  filterAll: 'All',
  filterReading: 'Underway',
  filterUnstarted: 'Unopened',
  filterFinished: 'Conquered',
  continueLegend: 'Weigh anchor',
  signIn: 'Come aboard',
  signOut: 'Go ashore',
  addBook: 'Add a book',
  addAnother: 'Add another',
  addSheetTitle: 'Haul a book aboard',
  addSubmit: 'Haul it aboard',
  addFromDevice: 'Add books from this device',
  addFromDeviceBlurb: 'Pick .m4b or .mp3 files from yer machine. No Google needed — they stay on this device.',
  orDivider: 'or',
  addIntro:
    'Open the folder in Google Drive, copy the address, and paste it below. Subfolders are searched too.',
  modeFilesTitle: 'Every file is a book',
  modeFilesBlurb:
    'One .m4b, one audiobook — with its own chapter markers read straight out of the file.',
  modeFolderTitle: 'Every folder is a book',
  modeFolderBlurb:
    'For books split into numbered files, where each subfolder is one title.',
  foldersLegend: 'Yer shelves',
  forget: 'Forget',
  refreshHint: 'Pull down on the hold to re-scan these for books added since.',
  pullText: 'Haul the line…',
  pullBusy: 'Sighting new books…',
  scanStart: 'Boarding the folder…',
  scanTidy: 'Tidying the shelf…',

  welcomeGlyph: '🏴‍☠️',
  welcomeTitle: 'Ahoy, and welcome aboard',
  welcomeBody:
    'Yarnbeard plays the audiobooks already sitting in yer Google Drive — and keeps yer place, yer marks and yer notes, book by book.',
  emptyGlyph: '🗺️',
  emptyTitle: 'The hold is empty',
  emptyBody:
    'Point Yarnbeard at a Drive folder. Every audio file inside becomes its own book.',
  noMatchTitle: 'Nothing matches',
  noMatchBody:
    'No book in the hold answers to that. Try another word, or another filter.',

  statusFinished: 'Finished · a tale well told',
  statusUnopened: (n) => `${n} chapters · not yet opened`,

  cancel: 'Belay that',
  save: 'Save',
  resume: 'Weigh anchor',
  start: 'Start the tale',
  relisten: 'Listen again',
  openBook: 'Open the book',
  sortHeader: 'Order the shelf by',
  renameTitle: 'Rename this tale',
  markFinished: 'Mark as finished',
  markUnread: 'Mark as unread',
  rescan: 'Re-scan from Drive',
  editTags: 'Edit tags',
  newArt: 'Paint a new flag',
  removeAction: 'Take it off the shelf',
  removeTitle: 'Off the shelf?',
  removeBody: (t) =>
    `"${t}" leaves Yarnbeard. Nothing in yer Drive is touched, but the reading position, marks and log entries go with it.`,
  startOver: 'Start over from the first page',
  startOverTitle: 'Back to page one?',
  startOverBody:
    'Yer reading position for this book is forgotten. Marks and log entries stay.',

  chaptersPanel: 'Chapters',
  marksPanel: 'Marks',
  notesPanel: 'Log',
  markNoun: 'mark',
  noteNoun: 'log entry',
  addNote: 'Log entry',
  noteSheetTitle: "Cap'n's Log",
  notePlaceholder: 'What struck ye?',
  noteSubmit: 'Write it down',
  noteEditTitle: 'Amend the entry',
  markRenameTitle: 'Name this mark',
  noMarksTitle: 'No marks on this chart',
  noMarksBody:
    'While a book plays, tap "X marks the spot" at the Helm to pin the exact second you\'re at.',
  noMarksGlyph: '❌',
  noNotesTitle: "A blank page, cap'n",
  noNotesBody:
    'Log entries are notes pinned to the exact moment in the book. Write one from here or from the Helm — then export the whole log to Drive.',
  noNotesGlyph: '📜',
  exportNotes: 'Save the log to Drive',
  exportHint:
    "Writes a Markdown file beside the audio in this book's own folder.",
  exportRefusedTitle: 'Drive would not take it',
  saveLocally: 'Save locally',
  exportDocTitle: "Cap'n's Log",
  exportMarksHeading: 'X marks the spot',
  exportNotesHeading: 'Log entries',
  exportEmptyLine: "_No entries yet — a blank page, cap'n._",
  exportKeptBy: 'Kept by Yarnbeard 🏴‍☠️',
  exportFileStem: "Capn's Log",
  markToast: (at) => `X marks the spot at ${at}.`,
  noteToast: 'Written in the log.',

  stow: 'Stow for offline',
  unstow: 'Empty hold',
  stowedWord: 'stowed',
  keptWord: 'in the hold',
  stowDone: 'Stowed below deck — plays with no signal.',
  stowCleared: 'Cleared from the hold.',

  speedTitle: 'Sailing speed',
  speedPerBook: 'Remember per book',
  speedPerBookBlurb:
    'Each tale keeps its own pace — a dense one slow, a familiar one quick.',
  sleepTitle: "Davy Jones' Locker",
  sleepIntro:
    'Set the watch and the story fades out on its own — no jolt, and yer place is kept.',
  sleepButton: 'Sleep',
  sleepChapterEnd: 'Stop at the end of this chapter',
  sleepExtend: 'Still awake — give me 10 more',
  sleepCancel: 'Cancel the watch',
  sleepStarted: (m) => `Lights out in ${m} minutes.`,
  sleepChapterToast: 'Stopping at the end of this chapter.',
  fadeLabel: 'Fade out',
  fadeBlurb: 'Ease the volume down over the last 20 seconds.',
  markButton: 'Mark',
  noteButton: 'Log',
  chaptersButton: 'Chapters',
  playerEmptyGlyph: '⚓️',
  playerEmptyTitle: 'Nothing at the helm',
  playerEmptyBody: "Pick a book from the hold and it'll take the wheel.",
  toLibrary: 'To the hold',

  entriesTab: 'Entries',
  marksTab: 'Marks',
  statsTab: 'Voyage',
  logSearchPlaceholder: 'Search the log…',
  logEmptyTitle: 'The log is empty',
  logEmptyBody:
    'Notes are pinned to the exact second of the book you were on. Tap "Log" at the Helm while listening, and everything lands here.',
  statTotal: 'at sea, all told',
  statStreak: 'day streak',
  statToday: 'today',
  statFinished: 'tales conquered',
  statUnderway: 'underway',
  statNotes: 'log entries',
  chartLegend: 'The last fortnight',
  statsNote:
    "Time is counted from audio actually heard — seeking and skipping don't pad the numbers. The streak holds as long as ye listen to something, however briefly, each day.",
  booksInLibrary: 'Books in the hold',
  marksDropped: 'Marks dropped',

  sectionAccount: 'The crew',
  sectionPlayback: 'At the helm',
  sectionSound: 'Sound',
  sectionSleep: 'The night watch',
  sectionOffline: 'The hold',
  sectionAppearance: "Ship's colours",
  sectionBackup: 'The chest',
  sectionAbout: 'About this vessel',
  sectionInstall: 'Bring it aboard',
  installTitle: 'Install Yarnbeard',
  installBody:
    'Put it on yer home screen: opens full-screen with its own flag, and works with no signal for books already in the hold.',
  installAction: 'Install',
  installedTitle: 'Aboard and installed',
  modeSystem: 'Follow the sky',
  modeLight: 'Old chart',
  modeDark: 'Night watch',
  offlineCountLabel: 'Stowed chapters',
  emptyOffline: 'Empty',
  emptyOfflineTitle: 'Empty the hold?',
  emptyOfflineBody: (n) =>
    `${n} stowed file(s) get thrown overboard. Nothing in yer Drive changes — they can be downloaded again.`,
  signOutTitle: 'Go ashore?',
  signOutBody:
    'Yer library stays on this device. Sign back in to keep syncing with Drive.',
  wipeTitle: 'Scuttle the local library?',
  wipeBody:
    'Books, positions, marks and log entries on this device are erased. If Drive sync is on, the Drive copy survives and comes back on the next sign-in.',
  wipeAction: 'Scuttle it',
  backupExportTitle: 'Export a backup',
  backupImportTitle: 'Restore a backup',
  aboutBlurb:
    'A pirate\'s audiobook player for Google Drive. Yer audio never leaves yer Drive — Yarnbeard fetches it with yer own credentials, plays it, and keeps only yer place, yer marks and yer notes.',
  syncedToast: 'Library squared away with Drive.',
};

const STUDIO: Vocab = {
  appMark: '',
  tagline: 'Your audiobooks, straight from Google Drive.',

  libraryTab: 'Library',
  notesTab: 'Notes',
  settingsTab: 'Settings',
  playerTitle: 'Now Playing',

  searchPlaceholder: 'Search your library',
  filterAll: 'All',
  filterReading: 'In progress',
  filterUnstarted: 'Not started',
  filterFinished: 'Finished',
  continueLegend: 'Jump back in',
  signIn: 'Sign in',
  signOut: 'Sign out',
  addBook: 'Add books',
  addAnother: 'Add more',
  addSheetTitle: 'Add from Drive',
  addSubmit: 'Add to library',
  addFromDevice: 'Add books from this device',
  addFromDeviceBlurb: 'Choose .m4b or .mp3 files from your device. No Google account needed — they stay on this device.',
  orDivider: 'or',
  addIntro:
    'Open the folder in Google Drive, copy its address, and paste it below. Subfolders are included.',
  modeFilesTitle: 'Each file is a book',
  modeFilesBlurb:
    'One .m4b, one audiobook — chapters read from the markers inside the file.',
  modeFolderTitle: 'Each folder is a book',
  modeFolderBlurb:
    'For books split across numbered files, where each subfolder is one title.',
  foldersLegend: 'Saved folders',
  forget: 'Remove',
  refreshHint: 'Pull down on the library to check these for new books.',
  pullText: 'Pull to refresh',
  pullBusy: 'Checking for new books…',
  scanStart: 'Opening folder…',
  scanTidy: 'Finishing up…',

  welcomeGlyph: '🎧',
  welcomeTitle: 'Welcome',
  welcomeBody:
    'Play the audiobooks already in your Google Drive. Yarnbeard remembers your place, your bookmarks and your notes for every book.',
  emptyGlyph: '📚',
  emptyTitle: 'Your library is empty',
  emptyBody:
    'Point Yarnbeard at a Drive folder. Every audio file inside becomes its own book.',
  noMatchTitle: 'No results',
  noMatchBody: 'Nothing in your library matches that. Try another word or filter.',

  statusFinished: 'Finished',
  statusUnopened: (n) => `${n} chapters · not started`,

  cancel: 'Cancel',
  save: 'Save',
  resume: 'Resume',
  start: 'Start listening',
  relisten: 'Listen again',
  openBook: 'Open book',
  sortHeader: 'Sort by',
  renameTitle: 'Edit details',
  markFinished: 'Mark as finished',
  markUnread: 'Mark as unfinished',
  rescan: 'Refresh from Drive',
  editTags: 'Edit tags',
  newArt: 'New artwork',
  removeAction: 'Remove from library',
  removeTitle: 'Remove this book?',
  removeBody: (t) =>
    `"${t}" is removed from Yarnbeard. Nothing in your Drive is touched, but its position, bookmarks and notes go with it.`,
  startOver: 'Start from the beginning',
  startOverTitle: 'Start over?',
  startOverBody:
    'Your position in this book is forgotten. Bookmarks and notes are kept.',

  chaptersPanel: 'Chapters',
  marksPanel: 'Bookmarks',
  notesPanel: 'Notes',
  markNoun: 'bookmark',
  noteNoun: 'note',
  addNote: 'Add note',
  noteSheetTitle: 'New note',
  notePlaceholder: 'What stood out?',
  noteSubmit: 'Save note',
  noteEditTitle: 'Edit note',
  markRenameTitle: 'Rename bookmark',
  noMarksTitle: 'No bookmarks yet',
  noMarksBody:
    'While a book is playing, tap Bookmark on the player to save the exact moment you are at.',
  noMarksGlyph: '🔖',
  noNotesTitle: 'No notes yet',
  noNotesBody:
    'Notes are pinned to an exact moment in a book. Write one here or from the player — then export them all to Drive.',
  noNotesGlyph: '📝',
  exportNotes: 'Export notes to Drive',
  exportHint: "Writes a Markdown file next to the audio in this book's folder.",
  exportRefusedTitle: 'Drive rejected the upload',
  saveLocally: 'Download instead',
  exportDocTitle: 'Notes',
  exportMarksHeading: 'Bookmarks',
  exportNotesHeading: 'Notes',
  exportEmptyLine: '_No entries yet._',
  exportKeptBy: 'Exported by Yarnbeard',
  exportFileStem: 'Notes',
  markToast: (at) => `Bookmarked at ${at}.`,
  noteToast: 'Note saved.',

  stow: 'Download',
  unstow: 'Remove download',
  stowedWord: 'downloaded',
  keptWord: 'cached',
  stowDone: 'Downloaded — plays without a connection.',
  stowCleared: 'Download removed.',

  speedTitle: 'Playback speed',
  speedPerBook: 'Remember per book',
  speedPerBookBlurb: 'Each book keeps its own speed.',
  sleepTitle: 'Sleep timer',
  sleepIntro:
    'Playback fades out when the timer runs down, and your place is saved.',
  sleepButton: 'Sleep',
  sleepChapterEnd: 'Stop at end of chapter',
  sleepExtend: 'Add 10 minutes',
  sleepCancel: 'Cancel timer',
  sleepStarted: (m) => `Sleeping in ${m} minutes.`,
  sleepChapterToast: 'Stopping at the end of this chapter.',
  fadeLabel: 'Fade out',
  fadeBlurb: 'Ease the volume down over the last 20 seconds.',
  markButton: 'Bookmark',
  noteButton: 'Note',
  chaptersButton: 'Chapters',
  playerEmptyGlyph: '🎧',
  playerEmptyTitle: 'Nothing playing',
  playerEmptyBody: 'Choose a book from your library to start listening.',
  toLibrary: 'Go to library',

  entriesTab: 'Notes',
  marksTab: 'Bookmarks',
  statsTab: 'Stats',
  logSearchPlaceholder: 'Search notes',
  logEmptyTitle: 'No notes yet',
  logEmptyBody:
    'Notes are pinned to the exact second you were on. Tap Note on the player while listening and they collect here.',
  statTotal: 'total listened',
  statStreak: 'day streak',
  statToday: 'today',
  statFinished: 'books finished',
  statUnderway: 'in progress',
  statNotes: 'notes',
  chartLegend: 'Last 14 days',
  statsNote:
    "Time counts audio actually heard — seeking and skipping don't inflate it. The streak holds as long as you listen to something each day.",
  booksInLibrary: 'Books in library',
  marksDropped: 'Bookmarks saved',

  sectionAccount: 'Account',
  sectionPlayback: 'Playback',
  sectionSound: 'Sound',
  sectionSleep: 'Sleep timer',
  sectionOffline: 'Downloads',
  sectionAppearance: 'Appearance',
  sectionBackup: 'Backup',
  sectionAbout: 'About',
  sectionInstall: 'Install',
  installTitle: 'Install Yarnbeard',
  installBody:
    'Add it to your home screen: opens full-screen with its own icon, and works offline for books you have downloaded.',
  installAction: 'Install',
  installedTitle: 'Installed',
  modeSystem: 'System',
  modeLight: 'Light',
  modeDark: 'Dark',
  offlineCountLabel: 'Downloaded files',
  emptyOffline: 'Clear',
  emptyOfflineTitle: 'Clear all downloads?',
  emptyOfflineBody: (n) =>
    `${n} downloaded file(s) will be deleted. Nothing in your Drive changes — they can be downloaded again.`,
  signOutTitle: 'Sign out?',
  signOutBody:
    'Your library stays on this device. Sign back in to resume syncing with Drive.',
  wipeTitle: 'Erase local data?',
  wipeBody:
    'Books, positions, bookmarks and notes on this device are erased. If Drive sync is on, the Drive copy survives and returns on your next sign-in.',
  wipeAction: 'Erase',
  backupExportTitle: 'Export a backup',
  backupImportTitle: 'Restore a backup',
  aboutBlurb:
    'An audiobook player for Google Drive. Your audio never leaves your Drive — Yarnbeard fetches it with your own credentials, plays it, and stores only your position, bookmarks and notes.',
  syncedToast: 'Library synced with Drive.',
};

const TABLE: Record<Skin, Vocab> = { pirate: PIRATE, studio: STUDIO };

@Injectable({ providedIn: 'root' })
export class CopyService {
  private settings = inject(SettingsService);

  /** The active vocabulary. Read as `t()` in templates. */
  readonly t = computed<Vocab>(() => TABLE[this.settings.skin()] ?? PIRATE);

  readonly isPirate = computed(() => this.settings.skin() === 'pirate');
}
