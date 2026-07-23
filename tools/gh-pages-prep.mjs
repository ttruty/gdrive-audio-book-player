/**
 * Make an Angular build survive GitHub Pages.
 *
 * Pages is a plain static file server with two habits that break a routed SPA:
 *
 *   1. No SPA fallback. A deep link like /repo/tabs/hold isn't a file, so Pages
 *      returns its 404 page instead of the app. Pages *does* serve a custom
 *      404.html for anything it can't find — so a copy of index.html there
 *      hands the URL to the Angular router and the route resolves normally.
 *      This also covers the PWA's start_url and long-press shortcuts.
 *
 *   2. Jekyll. Pages runs everything through Jekyll unless told otherwise, and
 *      Jekyll silently drops files and folders beginning with an underscore.
 *      An empty .nojekyll turns it off.
 *
 * Run after `ng build`. Idempotent.
 */
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DIST = resolve(process.argv[2] ?? 'dist/browser');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error(`\n  No index.html in ${DIST}. Run \`ng build\` first.\n`);
  process.exit(1);
}

// 1. SPA fallback.
await copyFile(join(DIST, 'index.html'), join(DIST, '404.html'));

// 2. Stop Jekyll touching the output.
await writeFile(join(DIST, '.nojekyll'), '');

// Report the base href so a mismatch is caught here rather than by a blank
// page in production — this is the single easiest thing to get wrong.
const html = await readFile(join(DIST, 'index.html'), 'utf8');
const base = html.match(/<base href="([^"]*)">/)?.[1] ?? '(none)';

console.log(`\n  Prepared ${DIST} for GitHub Pages`);
console.log(`    404.html      ✓  (deep links and refreshes will work)`);
console.log(`    .nojekyll     ✓`);
console.log(`    <base href>   ${base}`);

if (base === '/') {
  console.log(`
  Note: base href is "/". That is correct only for a user/org site
  (a repo literally named <user>.github.io). For a project site, rebuild with:

      ng build --base-href /<repo-name>/
`);
} else {
  console.log(`
  Publish at: https://<user>.github.io${base}
  Add https://<user>.github.io to your Google OAuth
  "Authorized JavaScript origins" — the origin only, no path.
`);
}
