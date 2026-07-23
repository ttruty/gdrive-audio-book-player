/**
 * Generate the app icons — a Jolly Roger in the app's own colours.
 *
 * The artwork is defined once here as SVG and rasterised by headless Chrome
 * (SVG → <img> → canvas → PNG), which gives proper anti-aliasing at every
 * size without pulling in an image toolchain.
 *
 * Two families come out of it:
 *   icon-<n>.png           full-bleed, for "any" purpose and iOS
 *   icon-maskable-<n>.png  artwork inset to ~62% so Android's circular and
 *                          squircle masks can't crop the skull
 *
 * Run manually — icons rarely change, and this needs Chrome:
 *   node tools/make-icons.mjs
 */
import { writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const OUT = 'src/icons';
const SIZES = [72, 96, 128, 144, 152, 180, 192, 384, 512];
const MASKABLE_SIZES = [192, 512];

// ── palette, matching the app's pirate skin ────────────────────────────────
const NAVY = '#0d1f2b';
const NAVY_DEEP = '#071620';
const BRASS = '#d9a441';
const BRASS_DIM = '#b98a33';

/**
 * The flag itself, drawn in a 512-unit square. `inset` shrinks the artwork
 * toward the centre for maskable variants, leaving the background full-bleed.
 */
function svg(inset = 1) {
  const s = inset;
  const t = 256 - 256 * s; // keep the scaled art centred

  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="sky" cx="34%" cy="26%" r="82%">
      <stop offset="0%" stop-color="#16374a"/>
      <stop offset="62%" stop-color="${NAVY}"/>
      <stop offset="100%" stop-color="${NAVY_DEEP}"/>
    </radialGradient>
    <linearGradient id="bone" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#f0d9a4"/>
      <stop offset="46%" stop-color="${BRASS}"/>
      <stop offset="100%" stop-color="${BRASS_DIM}"/>
    </linearGradient>
  </defs>

  <rect width="512" height="512" fill="url(#sky)"/>

  <g transform="translate(${t} ${t}) scale(${s})">
    <!-- Crossbones, behind the skull. A bone is a bar with two knobs per end.
         They run nearly corner to corner: stubby bones read as four unrelated
         blobs once the skull covers the crossing point. -->
    <g fill="url(#bone)">
      <g transform="rotate(45 256 256)">
        <rect x="44" y="237" width="424" height="38" rx="19"/>
        <circle cx="52" cy="228" r="30"/><circle cx="52" cy="284" r="30"/>
        <circle cx="460" cy="228" r="30"/><circle cx="460" cy="284" r="30"/>
      </g>
      <g transform="rotate(-45 256 256)">
        <rect x="44" y="237" width="424" height="38" rx="19"/>
        <circle cx="52" cy="228" r="30"/><circle cx="52" cy="284" r="30"/>
        <circle cx="460" cy="228" r="30"/><circle cx="460" cy="284" r="30"/>
      </g>
    </g>

    <!-- Skull. The dark outline is doing real work: without it the skull and
         the bones behind it are the same brass and merge into one shape. -->
    <g fill="url(#bone)" stroke="${NAVY_DEEP}" stroke-width="13" stroke-linejoin="round">
      <path d="M256 108
               C196 108,150 152,150 210
               C150 248,168 277,190 294
               L322 294
               C344 277,362 248,362 210
               C362 152,316 108,256 108 Z"/>
      <rect x="203" y="286" width="106" height="74" rx="26"/>
    </g>

    <g fill="${NAVY_DEEP}">
      <ellipse cx="212" cy="214" rx="35" ry="39"/>
      <ellipse cx="300" cy="214" rx="35" ry="39"/>
      <path d="M256 246 L277 288 L235 288 Z"/>
      <!-- Teeth: three gaps, wide enough to survive a 72px render. -->
      <rect x="229" y="292" width="12" height="68" rx="5"/>
      <rect x="250" y="292" width="12" height="68" rx="5"/>
      <rect x="271" y="292" width="12" height="68" rx="5"/>
    </g>
  </g>
</svg>`;
}

// ── rasterise via headless Chrome ──────────────────────────────────────────
function findChrome() {
  const candidates = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  return candidates.find((p) => existsSync(p));
}

const chromePath = findChrome();
if (!chromePath) {
  console.error('\n  No Chrome/Chromium found — needed to rasterise the icons.\n');
  process.exit(1);
}

const PORT = 9333;
const proc = spawn(
  chromePath,
  [
    '--headless',
    '--disable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${join(process.env.TMPDIR ?? '/tmp', 'yarnbeard-icons')}`,
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  for (let i = 0; i < 30; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('Chrome did not start');
}

const ws = new WebSocket(await connect());
let msgId = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));

const evaluate = async (expression) => {
  const n = ++msgId;
  const res = await new Promise((resolve) => {
    pending.set(n, resolve);
    ws.send(
      JSON.stringify({
        id: n,
        method: 'Runtime.evaluate',
        params: { expression, returnByValue: true, awaitPromise: true },
      })
    );
  });
  if (res.result?.exceptionDetails) {
    throw new Error(JSON.stringify(res.result.exceptionDetails));
  }
  return res.result?.result?.value;
};

/** Draw the SVG into a canvas at `size` and hand back base64 PNG bytes. */
async function render(svgText, size) {
  const encoded = Buffer.from(svgText, 'utf8').toString('base64');
  return evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/svg+xml;base64,${encoded}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = ${size};
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, ${size}, ${size});
    return c.toDataURL('image/png').split(',')[1];
  })()`);
}

const full = svg(1);
const maskable = svg(0.62);

for (const size of SIZES) {
  const b64 = await render(full, size);
  await writeFile(join(OUT, `icon-${size}.png`), Buffer.from(b64, 'base64'));
  console.log(`  icon-${size}.png`);
}
for (const size of MASKABLE_SIZES) {
  const b64 = await render(maskable, size);
  await writeFile(join(OUT, `icon-maskable-${size}.png`), Buffer.from(b64, 'base64'));
  console.log(`  icon-maskable-${size}.png`);
}

// Keep a vector copy: modern browsers take it as a favicon, and it's the
// source of truth if the artwork ever needs editing.
await writeFile(join(OUT, 'flag.svg'), full);
console.log('  flag.svg');

ws.close();
proc.kill();
console.log('\n  Done.\n');
