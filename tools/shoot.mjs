// Captures the three dossier screenshots from a built out/ directory with a headless Edge.
// Each shot is a JPEG whose quality is searched so the file lands in the dossier's 300-350 KB band.
//   node tools/shoot.mjs <out dir> <playwright-core dir>
import { createRequire } from 'node:module';
import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const outDir = resolve(process.argv[2] ?? 'out');
const pw = createRequire(join(resolve(process.argv[3]), 'package.json'))('playwright-core');
const page0 = pathToFileURL(join(outDir, 'dashboard', 'index.html')).href;
const shotsDir = resolve('screenshots');
const LO = 300 * 1024 + 2048, HI = 350_000;

const views = [
  ['1-board.jpg', '#tab=board&sort=rank&dir=asc', null],
  ['2-detail.jpg', '#tab=board&sort=rank&dir=asc&p=steakhouse-financial', null],
  ['3-filtered.jpg', '#tab=board&seg=early&mom=up&sort=change&dir=desc', null],
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
  if (!best || best.buf.length < LO) console.warn(`${name}: no quality lands in 300-350 KB (best ${best?.buf.length})`);
  writeFileSync(join(shotsDir, name), best.buf);
  console.log(`${name}: quality ${best.q}, ${best.buf.length} bytes`);
}
await browser.close();
