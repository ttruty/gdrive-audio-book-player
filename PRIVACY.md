# Privacy Policy

**Yarnbeard — an audiobook player for Google Drive**

**Last updated:** 23 July 2026

---

## The short version

Yarnbeard runs entirely in your web browser. There is no server, no backend, and
no account with us. Your Google credentials and your Drive files are exchanged
directly between your browser and Google. The developer cannot see your Google
account, your Drive, your files, your listening habits, or your notes — not
because we promise not to look, but because none of it is ever sent to us.

We collect nothing. We store nothing about you. We sell and share nothing.

---

## Who operates this app

Yarnbeard is a free, open-source, personal project operated by **[YOUR NAME]**.

Contact: **[YOUR CONTACT EMAIL]**

Source code: **[YOUR REPOSITORY URL]**

---

## What the app accesses in your Google Account

When you sign in, Google asks your permission for the following. You can review
and withdraw these at any time (see *Your control* below).

| Permission | What Yarnbeard does with it |
|---|---|
| `drive.readonly` — See and download your Google Drive files | Lists the folders you point the app at, reads the audio files inside them so they can be played, and reads the header of `.m4b`/`.mp4` files to find chapter markers, title, author and cover art. |
| `drive.file` — See, edit, create and delete only the specific Drive files you use with this app | Used for exactly one thing: writing your notes export as a Markdown file into a book's own folder, when you explicitly tap Export. This permission only ever applies to files this app itself creates. It does not grant access to your other documents. |
| `drive.appdata` — See, create and delete its own configuration data in your Drive | Stores a single hidden file holding your library, reading positions, bookmarks and notes, so they follow you between devices. This file lives in a special hidden area that no other app — and no other person — can read. |

The app requests read-only access to your Drive because it needs to play audio
files that you already own. It never modifies, moves or deletes your existing
files.

---

## What is stored, and where

Yarnbeard stores data in exactly three places. **None of them is a server we
control.**

### 1. On your device, in your browser

- Your book list, reading positions, bookmarks, notes, listening statistics and
  app settings, in browser local storage.
- Audio files you have played or downloaded, in the browser's cache storage, so
  books play offline and don't need re-downloading.
- Your Google access token, so you stay signed in. It is issued by Google,
  typically expires after about an hour, and is refreshed silently.

This data stays on that device. Clearing your browser's site data, or
uninstalling the app, removes all of it.

### 2. In your own Google Drive — a hidden sync file

If Drive sync is enabled (it is on by default, and can be turned off in
Settings), the app writes a single file named `yarnbeard-library.json` to Drive's
**application data folder**. It contains your library, reading positions,
bookmarks, notes and listening statistics.

This area is private by design: it is not visible when you browse Drive, and it
can only be read by this application. It exists so your place in a book follows
you from your phone to your laptop.

### 3. In your own Google Drive — notes you choose to export

When you tap *Export notes to Drive* on a book, the app writes a Markdown file
containing that book's notes and bookmarks into that book's own folder,
alongside the audio. This only happens when you ask for it. It is an ordinary
file in your Drive; you can read, move or delete it like any other.

**That is the complete list.** No data is transmitted anywhere else.

---

## What we do not do

- **No servers.** The app is a set of static files. There is no database, no API
  of ours, and nowhere for your data to be sent.
- **No analytics, telemetry or tracking.** No Google Analytics, no third-party
  scripts, no tracking cookies, no fingerprinting, no crash reporting.
- **No advertising**, and no data used for advertising or ad profiling.
- **No selling, renting or sharing** your data with anyone.
- **No use for training** machine-learning or AI models.
- **No human access.** The developer has no technical means to read your Drive
  content, your notes, or anything else in your account.

---

## Limited Use disclosure

Yarnbeard's use and transfer of information received from Google APIs to any
other app will adhere to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

Specifically:

- Data obtained through Google APIs is used **only** to provide and improve the
  user-facing features described in this policy — playing your audiobooks and
  keeping your place, bookmarks and notes.
- That data is **not transferred** to any third party, except as necessary to
  provide those features, to comply with applicable law, or as part of a merger
  or acquisition (neither applies to this project).
- That data is **not used for advertising** of any kind.
- **No humans read** that data, except where you have given explicit consent for
  specific items, where it is necessary for security purposes such as
  investigating abuse, or where required by law. In practice the developer has
  no technical means to do so at all.

---

## Third parties

Yarnbeard has no third-party integrations beyond Google itself:

- **Google** — provides sign-in and the Drive API. Your use of Google services is
  governed by the [Google Privacy Policy](https://policies.google.com/privacy).
  Google's official sign-in library is loaded from `accounts.google.com`.
- **The web host.** The app's files are served as static files by a hosting
  provider (currently GitHub Pages). Like any web server, the host may record
  standard request logs such as IP addresses as part of delivering the page.
  Those logs are the host's, not ours; we neither receive nor have access to
  them. See the
  [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

---

## Security

- All traffic is over HTTPS.
- Your access token is held in your browser's local storage and is short-lived.
- The app never sees or handles your Google password. Sign-in happens on
  Google's own pages.

Please note that data in your browser is accessible to anyone with access to
that browser profile. On a shared or public computer, sign out when you are
done.

---

## Your control, and how to delete everything

You can remove every trace of Yarnbeard at any time:

1. **Revoke the app's access to your Google Account** —
   [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
   → select Yarnbeard → Remove access.
2. **Delete the hidden sync file** — in Google Drive, go to Settings → *Manage
   apps*, find Yarnbeard, and choose *Delete hidden app data*.
3. **Delete any exported notes files** — these are ordinary files in your Drive
   folders; delete them as you would any other.
4. **Clear the data on your device** — use *Settings → Erase local data* inside
   the app, or clear the site's data in your browser, or uninstall the app.

You can also turn Drive sync off entirely in Settings, in which case nothing is
ever written to your Drive except notes you explicitly export.

---

## Children

Yarnbeard is not directed at children under 13 and does not knowingly collect
information from them. It collects no personal information from anyone.

---

## Changes to this policy

If this policy changes, the updated version will be published at this address
with a new "Last updated" date. Material changes affecting how your data is
handled will be reflected before the change takes effect.

---

## Contact

Questions about this policy or about your data:

**[YOUR CONTACT EMAIL]**
