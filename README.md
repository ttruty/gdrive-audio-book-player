# 🏴‍☠️ Yarnbeard

**Plunder yer audiobooks from the Google Drive seas.**

A pirate-themed audiobook player for the books already sitting in your Google
Drive. Point it at a folder and **every audio file in it becomes its own book** —
so a folder of `.m4b` audiobooks is a shelf, and each file's own embedded chapter
markers become its chapter list. Every book keeps its own place, its own speed,
its own marks, and its own Cap'n's Log of notes — which it can write back into
Drive as Markdown.

No backend, no server, no copies of your audio anywhere. Yarnbeard signs into
Drive with your own credentials, streams your files, and stores only where you
got to.

---

## Two themes

**Settings → Appearance** switches between them, and the choice covers both the
look *and* the language — a green-and-charcoal player that still said "Belay
that" on its cancel buttons would be a costume, not a theme.

| | **Yarnbeard** (default) | **Studio** |
|---|---|---|
| Palette | Brass, parchment, deep water | Charcoal and green |
| Type | Serif headings, spaced small-caps section rules | All sans, plain bold headings |
| Cover art | Pirate flag, scaled corners | Title initial, flat 4px corners |
| Buttons | Rounded | Pill |
| Voice | Pirate | Plain |

Each theme has its own light and dark mode, set independently, so there are four
combinations. The saved theme is applied before the first paint, so there's no
flash of the wrong one on load.

### The pirate vocabulary

Under the Yarnbeard theme the furniture gets renamed; under Studio everything is
called what it is.

| Yarnbeard | Studio |
|---|---|
| The Hold | Library |
| The Helm | Now Playing |
| Cap'n's Log | Notes |
| X marks the spot | Bookmarks |
| Weigh anchor | Resume |
| Davy Jones' Locker | Sleep timer |
| Stow below deck | Download |
| Charts | Settings |
| The chest | Backup |
| Belay that | Cancel |

The whole table lives in one file — `src/app/services/copy.service.ts` — so the
two voices are auditable side by side and can't leak into each other. It covers
the exported Markdown too: the same notes export as *"Cap'n's Log — Treasure
Island"* or *"Notes — Treasure Island"* depending on the theme.

Why "Yarnbeard"? Sailors *spin a yarn* — a long tale told at sea. Blackbeard
kept his crew; this one keeps your books.

---

## What it does

### Reading position, done properly
- **Per-book resume.** Every book remembers its chapter *and* the second within
  it. Keyed by Drive folder id, so it survives re-scans and follows you across
  devices.
- **Smart rewind.** Picking a book up after an hour rewinds a little; after a
  week, further. Away for a minute? No rewind at all. Cap is configurable.
- **Chapter completion tracking**, with a per-chapter progress sliver and a
  whole-book percentage that uses real measured durations once it has them.
- **Resumes into the mini-player on launch** without autoplaying — your place is
  right there, one tap away.

### Bookmarks and notes
- **X marks the spot** — one tap at the Helm pins the exact second.
- **Cap'n's Log** — notes attached to a book, chapter and timestamp. Writing one
  pauses playback so you can actually think, then resumes when you're done.
- **Tap any note or mark to leap straight back to that moment.**
- **Export the log to Drive** as a Markdown file written into the book's *own*
  folder, next to the audio — bookmarks and notes together, chapter by chapter.
  Falls back to a local download if Drive refuses the write.
- A **cross-library log tab** with search across every note and mark you've made.

### Listening
- **Speed 0.7×–3×**, remembered per book (a dense history slow, a familiar novel
  quick), with fine ±0.05 nudges.
- **Trim the silences** — clips the dead air between sentences via Web Audio
  RMS analysis. Shaves real minutes off a long book.
- **Volume boost** up to 2.5× for quiet recordings.
- **Sleep timer** with a 20-second fade-out, an "end of this chapter" option,
  and a *"Still awake — give me 10 more"* button.
- **Configurable skip** back/forward (defaults 15s / 30s), which roll over
  chapter boundaries instead of stopping dead at them.
- **Gapless-ish playback** — the next chapter is fetched while the current one
  plays.
- **Download progress on first play** — a percentage ring and byte count over
  the cover instead of an anonymous spinner, plus a bar in the mini-player.
  Falls back to a running byte count when the server won't say how big the file
  is. Those bytes are kept, so turning on "download ahead" never re-fetches a
  file you just waited for.
- **Lock screen / car stereo / headset controls** via the Media Session API,
  with cover art, chapter title and a live scrubber.
- **Screen wake lock** while playing.
- **Keyboard shortcuts** at a desk: `space`, `←`/`→`, `[`/`]`, `−`/`+`.

### `.m4b` / `.mp4` and embedded chapters
Formats: `mp3`, `m4a`, **`m4b`**, **`mp4`**, `aac`, `wav`, `ogg`, `opus`, `flac`, `wma`.

For MP4-family files Yarnbeard opens the container and reads what's inside it:

- **Chapter markers become real chapters** — navigable in the chapter list,
  seekable, bookmarkable, individually tracked for completion.
- Both storage conventions are read: **Nero `chpl`** lists and **QuickTime
  chapter tracks**. Files carrying only one of the two still work.
- **Title, author and cover art** come from the file's iTunes tags, so books
  name themselves instead of inheriting a filename.
- **Total running time is known before you press play**, straight from the
  movie header.
- Chapter jumps inside one file are **seeks, not loads** — nothing is
  re-downloaded and there's no gap, so a 30-hour `.m4b` navigates instantly.
- It reads the file's header via **HTTP range requests**, not the whole book:
  a 400 MB audiobook costs a few hundred KB to catalogue. Measured on test
  files: **1–4 ranged reads, ~3% of a 24 MB file** and proportionally far less
  as books get bigger.
- A file with no markers is simply a one-chapter book. A file that won't parse
  still plays.

### Two ways to add books

**From this device — no Google account needed.** Pick `.m4b`/`.mp3` files from
your machine and they become books straight away. The bytes are stored in the
browser (pinned in Cache Storage, never evicted), embedded `.m4b` chapters,
title, author and cover are read out just as they are for Drive files, and the
book plays entirely offline. Nothing is uploaded and no sign-in is required —
the option sits right on the welcome screen and in the add sheet. This is the
whole app, usable without ever touching Google.

Local books stay on the device that added them: they're excluded from Drive
sync (their bytes can't ride along in the sync file), and re-picking the same
file resumes it where you left off. Because they are the only copy, they are
never evicted from the cache — if you clear the cache, re-add the file.

**From Google Drive.**
- **Paste one Drive link.** Every audio file inside becomes its own book, and
  subfolders are searched too. Paste a link to a single file and you get that
  one book.
- **Or switch to "every folder is a book"** in the add sheet, for titles split
  across numbered files — then `Disc 1` / `Disc 2` subfolders flatten into one
  chapter spine, in order.
- **Cover art** from the file's embedded artwork, an image in the folder, or a
  generated pirate flag — deterministic per book, and re-rollable.
- **Author parsing** from embedded tags, falling back to `Author - Title` and
  `Title (Author)` names.
- Filter by **All / Underway / Unopened / Conquered**, sort five ways, search,
  tag, rename, mark finished, start over.
- **Pull-to-refresh** re-scans your saved shelves for books added since.

### Offline
- **Books you've played stay played.** Whatever playback downloads is kept, so
  switching between books — or coming back tomorrow — starts instantly instead
  of fetching the same file again.
- Bounded by a **size limit** (4 GB by default, adjustable, or no limit) with
  **least-recently-used eviction**. Files you downloaded on purpose are *pinned*
  and are never evicted to make room — only what playback kept on its own is
  fair game, so a deliberate download is always a promise.
- **Download a whole book** with one tap, with live progress and a cancel.
- Chapters serve from Cache Storage first, so a downloaded book needs no signal.
- Optional **read-ahead** of the next couple of chapters as you listen.
- **Storage readout** and a request for persistent storage.

### Sync
- **Drive appDataFolder sync** — one hidden JSON file only this app can read,
  invisible in your Drive UI, holding books, positions, marks, notes and stats.
- **Per-record merge**, not last-file-wins: listening on the phone and the
  laptop on the same day doesn't cost you a bookmark.
- Debounced pushes (8s idle, 30s floor) so a listening session isn't a write storm.

### Also
- **The voyage log** — time actually listened (seeking doesn't pad it), a daily
  streak, a fortnight bar chart, books conquered.
- **Backup to a file** and restore, entirely local.
- **Two themes**, each with light and dark modes, an installable PWA, and a
  service worker.

---

## Google Cloud setup (once)

You need your own OAuth client — only you can create this.

1. [Google Cloud Console](https://console.cloud.google.com/) → create or select a project.
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen** → **External** → fill in the
   basics → under **Test users**, add your own Google account. Leaving the app
   in "Testing" mode is fine and needs no verification.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized JavaScript origins**:
     - `http://localhost:4200` (used by `npm start`)
     - `http://localhost:8100` (used by `ionic serve`)
5. Copy the **Client ID** and paste it into `src/environments/environment.ts`:
   ```ts
   googleClientId: '1234567890-abc….apps.googleusercontent.com',
   ```

### Scopes, and why each one

| Scope | What it's for |
|---|---|
| `drive.readonly` | List your folders and download the audio |
| `drive.file` | Write the Cap'n's Log export into a book's folder — **per-file access only**: it can create files, never read your other documents |
| `drive.appdata` | The hidden sync file. Invisible to you and to every other app |

> **If you're reusing an OAuth client from another app**, add these three scopes
> under **OAuth consent screen → Data access → Add or remove scopes**, then
> revoke the app at [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
> so the next sign-in re-prompts for the new consent. Without that, the log
> export and Drive sync will fail with a 403 while playback still works.

---

## Run it

```bash
npm install
npm start          # http://localhost:4200
# or, with the Ionic CLI:
ionic serve        # http://localhost:8100
```

Then: **Come aboard** → **Add a book** → paste a Drive folder link.

---

## Install it (PWA)

Yarnbeard installs to a home screen or dock like a native app: its own icon, no
browser chrome, lock-screen controls, and it launches offline for books you've
already got.

### Why the dev server won't offer it

`npm start` builds in dev mode, and `main.ts` registers the service worker only
outside dev mode:

```ts
provideServiceWorker('ngsw-worker.js', { enabled: !isDevMode() })
```

No service worker means no install prompt, however correct the manifest is. So
**you can't install from `localhost:4200`** — that's the usual reason it seems
not to work.

### Install locally

```bash
npm run serve:pwa      # production build, served on http://localhost:4300
```

`localhost` counts as a secure origin, so the service worker registers and the
browser offers the install. Use the button in **Settings → Install**, or the
install icon in the address bar.

> Add `http://localhost:4300` to your OAuth client's **Authorized JavaScript
> origins**, or sign-in will be refused on that port.

### Install on a phone

The app must be on **HTTPS** with a real hostname. Any static host works — it's
a folder of files with no backend:

```bash
npm run build        # output lands in dist/browser/
```

| Host | Notes |
|---|---|
| **GitHub Pages** | Set up below — a workflow is included. |
| **Netlify / Vercel / Cloudflare Pages** | Drag `dist/browser` in, or point at the repo. HTTPS automatic. |
| **Firebase Hosting** | `firebase deploy`; set the public dir to `dist/browser`. |

Then, whichever you choose:

1. Add the deployed origin (e.g. `https://yarnbeard.example.com`) to
   **Authorized JavaScript origins** in the Google Cloud console.
2. Open it on the phone.
   - **Android / Chrome** — Settings → Install, or the browser's "Install app" menu item.
   - **iPhone / iPad** — Safari only. Share → **Add to Home Screen**. Safari
     never shows an install prompt, so the app gives written instructions instead.

---

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and publishes on every push to `main`.

**Setup, once:** repo **Settings → Pages → Source → GitHub Actions**. Push to
`main`; the app lands at `https://<user>.github.io/<repo>/`.

Then add **`https://<user>.github.io`** — the origin only, no path — to
**Authorized JavaScript origins** on your OAuth client, or sign-in is refused.

To build the same output locally:

```bash
npm run build:ghpages     # then: npm run serve:dist
```

> `package-lock.json` is committed and CI installs with `npm ci`, so the runner
> builds the exact dependency tree this was developed against. Don't delete it
> or regenerate it casually: the `^18.2.0` ranges have since drifted such that
> `@angular-devkit/core` wants `chokidar@^3` while `@angular/compiler-cli` wants
> `^4`. The locked tree nests them correctly (3.6.0 at the root, 4.0.3 under
> `compiler-cli`); a fresh resolve hoists v4 and `npm ci` then rejects the tree
> as invalid.

### What Pages needs that other hosts don't

Three things, all handled — worth knowing because each one fails in a way that
looks like a broken app rather than a misconfiguration:

- **It serves from a subpath.** `/<repo>/` is not `/`, so the build needs
  `--base-href /<repo>/`. Angular rewrites `index.html` *and* the service
  worker's `ngsw.json` asset paths to match. The workflow derives the value
  from the repo name, and correctly uses `/` when the repo is named
  `<user>.github.io` (a user site, served from the root). A wrong base href
  gives you a blank page and nothing else.
- **No SPA fallback.** `/<repo>/tabs/hold` isn't a file, so Pages 404s. It does
  serve a custom `404.html` for anything missing, so `tools/gh-pages-prep.mjs`
  copies `index.html` there — the URL reaches the Angular router and the route
  resolves. Without it, refreshing anywhere but the home page breaks, and so do
  the PWA's launch shortcuts.
- **Jekyll.** Pages runs it by default and it silently drops paths beginning
  with an underscore. The same script drops in `.nojekyll`.

Verified against a local server that emulates Pages exactly — subpath mount plus
404-status fallback: a cold deep link to `/<repo>/tabs/log` boots the app on the
right tab, the manifest's `start_url`, `scope` and shortcuts all resolve inside
the subpath, and the service worker registers with the subpath scope and
controls the page.

### Privacy Policy and Terms

[`PRIVACY.md`](PRIVACY.md) and [`TERMS.md`](TERMS.md) at the repo root are the
source of truth. `tools/build-legal.mjs` renders them into the build as
`privacy.html` and `terms.html` on every build, and the app links to both from
**Settings → About**.

They are published on the app's own origin on purpose: **Google's OAuth
verification requires the privacy policy to be on the same domain as the app**,
and GitHub renders repo Markdown on `github.com`, which is a different origin
from `github.io`. So the URLs to give Google are:

```
Homepage:        https://<user>.github.io/<repo>/
Privacy policy:  https://<user>.github.io/<repo>/privacy.html
Terms:           https://<user>.github.io/<repo>/terms.html
```

Both documents contain `[YOUR …]` placeholders — name, contact email, repository
URL, governing jurisdiction. The build prints a warning while any remain. Fill
them in before submitting for verification; Google rejects policies with
template text.

### Passing OAuth verification

Google's reviewer checks two things about the home page. Both are handled in the
app, but one has a matching setting you must change in the Cloud console:

1. **The home page must explain the app's purpose.** The signed-out home page
   (`src/app/components/landing.component.ts`) states the name and purpose
   plainly, lists what the app does, describes exactly what it accesses in your
   Google account, and links the privacy policy and terms. Because the reviewer
   may fetch the page *without running JavaScript*, `index.html` also carries the
   same name, purpose and policy links as static pre-boot content and a
   plain-language `<meta name="description">` — so the served HTML explains
   itself even before Angular loads.

2. **The app name must match.** The app is named **`Yarnbeard`** everywhere — the
   `<h1>`, the `<title>`, the manifest `short_name`. In the Cloud console, set
   **OAuth consent screen → App name** to exactly `Yarnbeard` (the earlier
   rejection was for `YarnBeard` — the capital B did not match). Also set
   **Application home page** to your deployed root URL, and the
   **Privacy policy** and **Terms of service** links to the `privacy.html` and
   `terms.html` URLs on that same origin.

After changing the consent screen, submit for verification again.

### One thing to know about sharing it

The page is public, but the data isn't: visitors sign in with their own Google
account and only ever see their own Drive. The OAuth client ID in the bundle is
not a secret — public clients are meant to expose it.

However, while your OAuth consent screen is in **Testing**, only accounts you've
added as test users can sign in; everyone else gets an error. That's the right
setting for personal use and needs no verification. Opening it to anyone would
mean publishing the consent screen, and because `drive.readonly` is a
*restricted* scope, Google requires app verification before it will allow that.

### The icon

A Jolly Roger in the app's own brass-on-navy, generated from a single SVG
defined in `tools/make-icons.mjs` and rasterised by headless Chrome:

```bash
node tools/make-icons.mjs      # rewrites src/icons/*
```

Two families come out of it, which matters more than it sounds:

- `icon-<n>.png` — full-bleed, for the `any` purpose and for iOS, which applies
  its own rounded-rect mask and needs an opaque edge-to-edge image.
- `icon-maskable-<n>.png` — the same artwork inset to 62%, so Android's circular
  and squircle masks crop background rather than the skull. Pointing the
  `maskable` entries at the full-bleed files (the easy mistake) gets the bones
  sliced off on most Android launchers.

`icons/flag.svg` is emitted too, and serves as the favicon so browser tabs stay
crisp at any density.

### What being installed gets you

- Own icon, full-screen, no address bar.
- **Launches with no network** — the app shell is cached, and downloaded books
  play offline. Only sign-in and adding new books need a connection.
- **Long-press shortcuts** straight to *Continue listening* or *Library*.
- Tapping the icon **focuses the running app** rather than reloading it
  (`launch_handler: focus-existing`), so it never interrupts playback.

---

## How it works

- **Auth** — Google Identity Services OAuth token flow. No backend; the access
  token lives in the browser and is refreshed silently. Concurrent refreshes are
  coalesced so a burst of 401s can't open five popups.
- **Books** — either one audio file (chapters = embedded markers) or a Drive
  folder (chapters = its audio files in natural order, so `Chapter 2` sorts
  before `Chapter 10`). Internally a chapter is always a `[start, end)` window
  over a Drive file, which is why both shapes behave identically everywhere.
- **Chapter parsing** — `src/app/util/mp4.ts` walks the ISO base-media box tree
  over ranged reads to find `moov`, then reads `chpl`, the `text` chapter track,
  `mvhd` and the iTunes `ilst` tags out of it.
- **Playback** — private Drive files can't be an `<audio src>` (they need an
  `Authorization` header), so each file is fetched as a blob and played from an
  object URL. Blobs are re-labelled by extension, because Drive reports `.m4b`
  as `application/octet-stream` often enough to break playback otherwise.
- **State** — signals throughout. `localStorage` is the local source of truth;
  Drive's appDataFolder is the cross-device one.
- **Offline** — Cache Storage is authoritative; a `localStorage` index mirrors
  the ids purely so the UI can paint without awaiting the cache.

---

## Known limits

- **Playback downloads the whole file before it starts.** Chapter *parsing* is
  ranged and cheap, but pressing play on a 500 MB `.m4b` means waiting for
  500 MB. The wait is at least legible — a live percentage ring and byte count
  on the cover, and a progress bar in the mini-player — but it is still a wait.
  It is a *one-time* wait: the file is kept afterwards, so every later play of
  that book starts instantly. True range streaming would need a service worker
  proxying `Range` requests with the auth header attached; that isn't built.
- For folder books, chapter durations are only known once a chapter has played,
  so a brand-new one shows chapter counts instead of hours. Books with embedded
  markers know their times immediately.
- Skip-silence needs Web Audio, which some mobile browsers only wake after a
  user gesture; it engages on the first tap.
- Only chapter *markers* are read from MP4 containers — not embedded lyrics,
  ratings or other iTunes metadata beyond title, author, album and cover.

## Build for native (later)

```bash
npm install @capacitor/ios @capacitor/android
npx cap init && npx cap add ios      # and/or android
npm run build && npx cap sync
```

For native, register an iOS/Android OAuth client (or use a Capacitor Google-auth
plugin) — the browser origin flow doesn't apply inside a native WebView.

---

*Dead men tell no tales. Yer books, however, tell plenty.* 🦜
