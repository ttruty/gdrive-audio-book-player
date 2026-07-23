/**
 * A tiny static server for the production build, so the PWA can actually be
 * installed locally.
 *
 * `ng serve` builds in dev mode, where the service worker is disabled — and
 * without a service worker the browser will never offer to install the app.
 * This serves `dist/browser` instead, over http://localhost, which browsers
 * treat as a secure origin. That is enough to meet every install criterion.
 *
 * Deliberately dependency-free: no install step, works offline.
 *
 *   npm run serve:pwa
 */
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.argv[2] ?? 'dist/browser');
const PORT = Number(process.env.PORT ?? 4300);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function tryFile(path) {
  try {
    const s = await stat(path);
    return s.isFile() ? path : null;
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    // normalize() collapses any ../ before we join, so requests can't escape ROOT.
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = await tryFile(join(ROOT, rel));

    // Angular routes like /tabs/hold aren't files — fall back to the shell.
    if (!file) file = await tryFile(join(ROOT, 'index.html'));
    if (!file) {
      res.writeHead(404).end('Build not found. Run: npm run build');
      return;
    }

    const ext = extname(file).toLowerCase();
    const headers = { 'Content-Type': TYPES[ext] ?? 'application/octet-stream' };

    // The worker and its manifest must never be served stale, or an update
    // can never take hold. Everything else is hashed by the build anyway.
    if (/ngsw|index\.html|\.webmanifest$/.test(file)) {
      headers['Cache-Control'] = 'no-cache';
    }
    // Required for the service worker to control the whole app.
    if (file.endsWith('ngsw-worker.js')) headers['Service-Worker-Allowed'] = '/';

    res.writeHead(200, headers).end(await readFile(file));
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

server.listen(PORT, () => {
  console.log(`\n  Yarnbeard (production build) → http://localhost:${PORT}\n`);
  console.log('  localhost counts as a secure origin, so the service worker');
  console.log('  registers and the browser will offer to install the app.');
  console.log('  Look for the install icon in the address bar.\n');
  console.log('  Add http://localhost:' + PORT + ' to your Google OAuth');
  console.log('  "Authorized JavaScript origins" or sign-in will be refused.\n');
});
