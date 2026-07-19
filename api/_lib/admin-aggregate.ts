/**
 * Pure shaping for /api/admin/stats. Kept free of `pg` and of any request
 * object so it runs under plain node in tests: the route does the querying,
 * everything here is deterministic given rows in and a fixed "today".
 *
 * The database side deliberately returns GROUPED counts (one row per
 * couple/day per source) rather than one correlated subquery per couple; the
 * merging back into per-couple and per-day shapes happens here.
 */

/** One content kind counted across the dashboard. `table` is a literal from our own source. */
export interface ContentSource {
  src: string;
  table: string;
}

export interface ActivityCountRow {
  day: string;
  src: string;
  n: number;
}

export interface ActivityDay {
  day: string;
  counts: Record<string, number>;
  total: number;
}

export interface CoupleCountRow {
  couple_id: string;
  src: string;
  n: number;
}

export interface CoupleBase {
  id: string;
  created_at: string;
  encrypted: boolean;
}

export interface CoupleRow {
  /** Short opaque prefix, never the full id: enough to tell rows apart, not to address a couple. */
  id: string;
  created_at: string;
  members: number;
  encrypted: boolean;
  counts: Record<string, number>;
  total: number;
  last_active: string | null;
}

/**
 * The n UTC day-strings ending at (and including) `todayUTC`, oldest first.
 * Pure string/epoch math, no local-time Date parsing, matching the approach in
 * streak.ts and milestone-countdown.ts.
 */
export function lastNDays(n: number, todayUTC: string): string[] {
  const [y, m, d] = todayUTC.slice(0, 10).split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

/**
 * One entry per day in `days` (so the chart has no gaps, even at zero), each
 * carrying a count per source plus their total. Rows for days outside the
 * window are ignored; rows for unknown sources are ignored rather than
 * silently inflating the total.
 */
export function buildActivitySeries(
  days: string[],
  rows: ActivityCountRow[],
  sources: readonly string[]
): ActivityDay[] {
  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const cur = byDay.get(r.day) ?? {};
    cur[r.src] = (cur[r.src] ?? 0) + r.n;
    byDay.set(r.day, cur);
  }
  return days.map((day) => {
    const row = byDay.get(day) ?? {};
    const counts: Record<string, number> = {};
    let total = 0;
    for (const src of sources) {
      const n = row[src] ?? 0;
      counts[src] = n;
      total += n;
    }
    return { day, counts, total };
  });
}

/**
 * Per-couple volume, biggest first. Every couple in `couples` appears even
 * with nothing made yet (a zero row is a real signal: someone signed up and
 * bounced). The emitted id is truncated here, so a full couple id never
 * reaches the client.
 */
export function buildCoupleRows(
  couples: CoupleBase[],
  counts: CoupleCountRow[],
  lastActive: { couple_id: string; last_active: string | null }[],
  members: { couple_id: string; members: number }[],
  sources: readonly string[]
): CoupleRow[] {
  const countsByCouple = new Map<string, Record<string, number>>();
  for (const r of counts) {
    const cur = countsByCouple.get(r.couple_id) ?? {};
    cur[r.src] = (cur[r.src] ?? 0) + r.n;
    countsByCouple.set(r.couple_id, cur);
  }
  const lastByCouple = new Map(lastActive.map((r) => [r.couple_id, r.last_active]));
  const membersByCouple = new Map(members.map((r) => [r.couple_id, r.members]));

  return couples
    .map((c) => {
      const raw = countsByCouple.get(c.id) ?? {};
      const out: Record<string, number> = {};
      let total = 0;
      for (const src of sources) {
        const n = raw[src] ?? 0;
        out[src] = n;
        total += n;
      }
      return {
        id: c.id.slice(0, 8),
        created_at: c.created_at,
        members: membersByCouple.get(c.id) ?? 0,
        encrypted: c.encrypted,
        counts: out,
        total,
        last_active: lastByCouple.get(c.id) ?? null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * How many couples did anything at all since `sinceISO`. Derived from the
 * last-active rows we already have rather than its own UNION query, and it
 * therefore stays in step with whatever sources feed that query.
 */
export function countActiveSince(
  lastActive: { couple_id: string; last_active: string | null }[],
  sinceISO: string
): number {
  let n = 0;
  for (const r of lastActive) {
    if (r.last_active && r.last_active >= sinceISO) n += 1;
  }
  return n;
}

/** `SELECT couple_id, created_at, '<src>' AS src FROM <table>` for each source, UNION ALL'd. */
export function unionAllSources(sources: readonly ContentSource[]): string {
  return sources
    .map((s) => `SELECT couple_id, created_at, '${s.src}' AS src FROM ${s.table}`)
    .join(' UNION ALL ');
}
