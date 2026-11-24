// Token Radar for make.fun's token-radar-01 (Node 22, standard library only, no network).
//
// Reads the sealed snapshot, runs the value model in dashboard/model.js (the same file the page runs),
// writes /output/board.json, /output/data.js, copies dashboard/ and screenshots/, then the dossier.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { boardIssue, type BoardRow } from './lib/gate.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1]! : fallback;
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
if (!existsSync(inputFile)) {
  process.stderr.write(`token radar: no snapshot at ${inputFile}: pass --input <snapshot.json|dir>\n`);
  process.exit(2);
}
const snapshot = JSON.parse(readFileSync(inputFile, 'utf8'));

// Run the page's model in a sandboxed context: one code path for the board and the screen.
const sandbox: Record<string, any> = {};
runInNewContext(readFileSync(join(here, 'dashboard', 'model.js'), 'utf8'), sandbox, { filename: 'model.js' });
const radar = sandbox.RadarModel.build(snapshot);

const rows: BoardRow[] = radar.rows.map((r: any) => ({
  rank: r.rank,
  slug: r.slug,
  name: r.name,
  implied_value_usd: r.implied_value_usd,
  farm_steps: r.plan.steps.map((s: any) => `${s.title}. ${s.text} Cost: ${s.cost}. Time: ${s.time}.`),
  category: r.category,
  tvl_usd: r.tvl_usd,
  change_7d: r.change_7d,
  segment: r.segment,
  model: { peer_multiple: r.factors.multiple, momentum: r.factors.momentum, runway: r.factors.runway, age_days: r.factors.age_days },
  plan_cost_usd: r.plan.usd === null ? null : Math.round(r.plan.usd * 100) / 100,
  plan_days: r.plan.days,
}));

const issue = boardIssue(rows, snapshot);
if (issue) {
  process.stderr.write(`token radar: board refused: ${issue}\n`);
  process.exit(1);
}

mkdirSync(out, { recursive: true });
const board = {
  as_of: snapshot.as_of,
  source: snapshot.source,
  model: radar.model.version,
  formula: 'implied = tvl_usd x peer_multiple(category) x momentum(change_7d) x runway(days tracked with no token)',
  note: 'Each protocol listed records no token on DefiLlama; an implied value is this board\'s claim, not a forecast that a token will launch.',
  comparables: radar.live.length,
  parked: radar.parked.map((p: any) => ({ slug: p.slug, why: p.why })),
  rows,
};
writeFileSync(join(out, 'board.json'), JSON.stringify(board) + '\n');
writeFileSync(join(out, 'data.js'), `window.SNAPSHOT = ${JSON.stringify(snapshot)};\n`);

function copyDir(from: string, to: string): string[] {
  mkdirSync(to, { recursive: true });
  const names = readdirSync(from).filter((n) => !n.startsWith('.') && statSync(join(from, n)).isFile()).sort();
  for (const n of names) copyFileSync(join(from, n), join(to, n));
  return names;
}

copyDir(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = existsSync(join(here, 'screenshots')) ? copyDir(join(here, 'screenshots'), join(out, 'screenshots')) : [];
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536 }));
process.stdout.write(`token radar: ${rows.length} pre-token rows, ${radar.live.length} trading comparables, ${radar.parked.length} parked, ${shots.length} screenshots\n`);
