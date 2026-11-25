// Captures the four dossier screenshots from a built out/ directory with a headless Edge.
// Four images must stay under the dossier's 1.5 MiB cap, so each targets 240-270 KB.
//   node tools/shoot.mjs <out dir> <playwright-core dir>
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = resolve(process.argv[2] ?? 'out');
const pw = createRequire(join(resolve(process.argv[3]), 'package.json'))('playwright-core');
const page0 = pathToFileURL(join(outDir, 'dashboard', 'index.html')).href;
const shotsDir = resolve('screenshots');
const LO = 240 * 1024, HI = 270 * 1024;

const views = [
  ['1-board.jpg', '#tab=board&sort=rank&dir=asc'],
  ['2-detail.jpg', '#tab=board&sort=rank&dir=asc&p=steakhouse-financial'],
  ['3-filtered.jpg', '#tab=board&seg=early&mom=up&sort=change&dir=desc'],
  ['4-compare.jpg', '#tab=compare&seg=early&mom=up&sort=change&dir=desc'],
];

const browser = await pw.chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
mkdirSync(shotsDir, { recursive: true });
for (const f of readdirSync(shotsDir)) unlinkSync(join(shotsDir, f));
for (const [name, hash] of views) {
  await page.goto(page0 + hash);
  await page.reload();
  await page.waitForTimeout(400);
  let lo = 30, hi = 100, best = null;
  while (lo <= hi) {
    const q = (lo + hi) >> 1;
    const buf = await page.screenshot({ type: 'jpeg', quality: q });
    if (buf.length > HI) hi = q - 1;
    else { best = { q, buf }; if (buf.length >= LO) break; lo = q + 1; }
  }
  if (!best || best.buf.length < LO) console.warn(`${name}: no quality lands in 240-270 KB (best ${best?.buf.length})`);
  writeFileSync(join(shotsDir, name), best.buf);
  console.log(`${name}: quality ${best.q}, ${best.buf.length} bytes`);
}
await browser.close();
