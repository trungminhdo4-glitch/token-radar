// The gate's board rules, checked before anything is written: a board the scorer would refuse
// stops the run with the reason instead of shipping an invalid entry.

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  [extra: string]: unknown;
}

export interface SnapshotLike {
  protocols: { slug: string }[];
  watchlist: string[];
}

const MAX_VALUE = 100_000_000_000_000;

/** The first rule the board breaks, or null when the scorer would take it. */
export function boardIssue(rows: BoardRow[], snap: SnapshotLike): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, the gate wants 100 to 4000`;
  const known = new Set(snap.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of rows) {
    if (typeof r.slug !== 'string' || !/^\S{1,128}$/.test(r.slug)) return `bad slug ${JSON.stringify(r.slug)}`;
    if (!known.has(r.slug)) return `slug ${r.slug} is not in the snapshot`;
    if (seen.has(r.slug)) return `slug ${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug}: empty name`;
    if (!Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 || r.implied_value_usd > MAX_VALUE) return `${r.slug}: implied value ${r.implied_value_usd} is not a positive whole number within the cap`;
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug}: ${r.farm_steps?.length} farm steps, the gate wants 3 to 12`;
    for (const s of r.farm_steps) {
      const n = typeof s === 'string' ? s.trim().length : 0;
      if (n < 20 || n > 600) return `${r.slug}: a farm step of ${n} characters, the gate wants 20 to 600`;
    }
  }
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < byRank.length; i++) {
    if (byRank[i]!.rank !== i + 1) return `ranks are not exactly 1..${rows.length}`;
    if (i > 0 && byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `implied value rises at rank ${i + 1}`;
  }
  if (new Set(rows.map((r) => r.implied_value_usd)).size === 1) return 'every implied value is the same';
  const missing = snap.watchlist.filter((w) => !seen.has(w));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.slice(0, 5).join(', ')}`;
  return null;
}
