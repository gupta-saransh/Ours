/**
 * Pure aggregation for the admin dashboard. No `pg`, no request object, no
 * React, so every rule here is unit tested under plain node.
 *
 * The job of this module is turning the shapes a database returns (one row per
 * day per source, one row per couple per source) into the shapes a dashboard
 * actually renders: a dense series with no gaps, a KPI carrying its own
 * baseline and sparkline, a ranked leaderboard. Doing that in SQL means either
 * many queries or unreadable ones; doing it in the screen means it cannot be
 * tested.
 *
 * The database side always returns GROUPED counts (one row per couple/day per
 * source). Never one correlated subquery per couple: at a few hundred couples
 * that was thousands of scans in a single request.
 */

/**
 * Delimiter the SQL uses to join member names into one column, and this module
 * uses to split them apart again. A control character, so it cannot collide
 * with anything a person could type into a display name (a comma or a plus
 * sign absolutely could).
 */
export const NAME_DELIM = '\u0001';

/**
 * One content kind counted across the dashboard. Every field is a literal from
 * our own source list, never anything a request can influence.
 *
 * `where` exists so one table can supply two mutually exclusive sources: chat
 * splits into `messages` (text/photo) and `voice` (a voice note), which is how
 * voice notes get their own column everywhere WITHOUT being counted twice
 * inside the message total. Any future split must stay mutually exclusive for
 * the same reason.
 *
 * `userCol` is the column naming WHO made the row. It is what makes the
 * per-person breakdown possible at all; the tables disagree about the name
 * (`sender_id`, `author_id`, `user_id`, `proposer_id`, `added_by`), so it is
 * declared per source rather than guessed.
 */
export interface ContentSource {
  src: string;
  table: string;
  where?: string;
  userCol?: string;
}

function whereClause(s: ContentSource): string {
  return s.where ? ` WHERE ${s.where}` : '';
}

/** `SELECT couple_id, created_at, '<src>' AS src FROM <table>` for each source, UNION ALL'd. */
export function unionAllSources(sources: readonly ContentSource[]): string {
  return sources
    .map((s) => `SELECT couple_id, created_at, '${s.src}' AS src FROM ${s.table}${whereClause(s)}`)
    .join(' UNION ALL ');
}

/**
 * The same union, carrying WHO made each row. Sources with no `userCol` are
 * skipped rather than attributed to nobody, so a per-person total is always
 * made of rows that genuinely have an author.
 *
 * Note on `wishlist`: the author column is `added_by`, not `owner_id`. A secret
 * gift plan lives on your PARTNER's list, so the owner is not the person who
 * used the feature, and attributing it to them would credit the wrong half of
 * the couple.
 */
export function unionAllPeople(sources: readonly ContentSource[]): string {
  return sources
    .filter((s) => !!s.userCol)
    .map(
      (s) =>
        `SELECT ${s.userCol} AS user_id, couple_id, created_at, '${s.src}' AS src FROM ${s.table}${whereClause(s)}`
    )
    .join(' UNION ALL ');
}

/**
 * The n UTC day-strings ending at (and including) `todayUTC`, oldest first.
 * Pure string/epoch math, no local-time Date parsing, matching the approach in
 * streak.ts and milestone-countdown.ts.
 */
export function lastNDays(n: number, todayUTC: string): string[] {
  if (n <= 0) return [];
  const [y, m, d] = todayUTC.slice(0, 10).split('-').map(Number);
  const base = Date.UTC(y, m - 1, d);
  if (Number.isNaN(base)) return [];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
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

/**
 * One entry per day in `days` (so the chart has no gaps, even at zero), each
 * carrying a count per source plus their total. A quiet stretch must still
 * occupy its real width, or the x-axis lies about time. Rows outside the window
 * are ignored; rows for unknown sources are ignored rather than silently
 * inflating the total.
 */
export function buildActivitySeries(
  days: string[],
  rows: ActivityCountRow[],
  sources: readonly string[]
): ActivityDay[] {
  const byDay = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const cur = byDay.get(r.day) ?? {};
    cur[r.src] = (cur[r.src] ?? 0) + (Number(r.n) || 0);
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

// ---------------------------------------------------------------------------
// KPIs
//
// A bare number on a card is close to useless: "15 game rounds" gives you no
// way to know whether that is good, and no reason to look again tomorrow. Every
// headline therefore carries the same three things: the value, what it was over
// the preceding window of equal length, and the shape it traced getting here.
// ---------------------------------------------------------------------------

export interface Kpi {
  value: number;
  previous: number;
  /** Percent change vs the previous window; null when there is no baseline. */
  deltaPct: number | null;
  /** Per-day values across the window, for the card's sparkline. */
  spark: number[];
}

/**
 * Percent change, rounded. Null when the baseline is zero: "up 100%" from
 * nothing is noise, and dividing by zero would render Infinity on the card.
 */
export function deltaPct(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** A KPI for a FLOW (things created during the window): the value is the sum. */
export function flowKpi(spark: number[], previous: number): Kpi {
  const value = spark.reduce((a, b) => a + (Number(b) || 0), 0);
  return { value, previous, deltaPct: deltaPct(value, previous), spark };
}

/** A KPI for a LEVEL (people, spaces): the value is a standing count, not a sum. */
export function levelKpi(value: number, previous: number, spark: number[]): Kpi {
  return { value, previous, deltaPct: deltaPct(value, previous), spark };
}

/** Daily count of DISTINCT spaces that produced something: the real activity pulse. */
export function activeSpacesSpark(days: string[], rows: { day: string; couple_id: string }[]): number[] {
  const byDay = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, new Set());
    byDay.get(r.day)!.add(r.couple_id);
  }
  return days.map((d) => byDay.get(d)?.size ?? 0);
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------

export interface CoupleBase {
  id: string;
  created_at: string;
  encrypted: boolean;
  streak?: number;
}

export interface CoupleRow {
  /** Short prefix, enough to tell rows apart and to find the row in the DB by hand. */
  id: string;
  /** Member display names. Empty for an abandoned shell with no members left. */
  names: string[];
  members: number;
  created_at: string;
  encrypted: boolean;
  streak: number;
  counts: Record<string, number>;
  total: number;
  last_active: string | null;
  /** No members at all: a leftover couple row, counted apart from real spaces. */
  empty: boolean;
}

/**
 * The leaderboard: one row per space, busiest first. Every space appears even
 * with nothing made yet, because a zero row is a real signal (someone signed up
 * and bounced).
 *
 * MEMBER NAMES ARE INCLUDED, by an explicit product decision recorded in
 * CLAUDE.md. The dashboard exists to show which couples are thriving and which
 * have gone quiet, and an opaque id prefix makes that impossible to act on.
 * Content is still never read and never decrypted: this is names and counts.
 */
export function buildCoupleRows(
  couples: CoupleBase[],
  counts: { couple_id: string; src: string; n: number }[],
  lastActive: { couple_id: string; last_active: string | null }[],
  members: { couple_id: string; members: number; names?: string | null }[],
  sources: readonly string[]
): CoupleRow[] {
  const countsByCouple = new Map<string, Record<string, number>>();
  for (const r of counts) {
    const cur = countsByCouple.get(r.couple_id) ?? {};
    cur[r.src] = (cur[r.src] ?? 0) + (Number(r.n) || 0);
    countsByCouple.set(r.couple_id, cur);
  }
  const lastByCouple = new Map(lastActive.map((r) => [r.couple_id, r.last_active]));
  const membersByCouple = new Map(members.map((r) => [r.couple_id, r]));

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
      const m = membersByCouple.get(c.id);
      const memberCount = Number(m?.members ?? 0);
      return {
        id: c.id.slice(0, 8),
        names: String(m?.names ?? '')
          .split(NAME_DELIM)
          .map((s) => s.trim())
          .filter(Boolean),
        members: memberCount,
        created_at: c.created_at,
        encrypted: !!c.encrypted,
        streak: Number(c.streak ?? 0),
        counts: out,
        total,
        last_active: lastByCouple.get(c.id) ?? null,
        empty: memberCount === 0,
      };
    })
    // Busiest first; ties broken by most recently active, so a fresh quiet
    // space does not outrank an older one purely by the order rows arrived.
    .sort((a, b) => b.total - a.total || (b.last_active ?? '').localeCompare(a.last_active ?? ''));
}

// ---------------------------------------------------------------------------
// Per-person feature usage
//
// The couple leaderboard answers "which spaces are alive". It cannot answer
// "who is using what", which is a different question with a different unit: a
// space where one partner does everything and the other has never opened the
// chat looks identical, at couple level, to one where both are engaged. These
// rows are that missing dimension.
//
// Same privacy line as the leaderboard: display names and counts, never content.
// ---------------------------------------------------------------------------

export interface PersonUsageRow {
  id: string;
  name: string;
  /** Short couple prefix, matching the leaderboard's truncation. */
  coupleId: string | null;
  /** Both members' names, so a person is placed without cross-referencing. */
  coupleName: string;
  /** Lifetime count per source. */
  counts: Record<string, number>;
  total: number;
  /** Count per source within the selected window, for the window toggle. */
  windowCounts: Record<string, number>;
  windowTotal: number;
  /** Distinct sources they have EVER used: the breadth signal at a glance. */
  featuresUsed: number;
  lastActive: string | null;
}

export interface PersonBase {
  id: string;
  display_name: string;
  couple_id: string | null;
}

function tally(
  rows: { user_id: string; src: string; n: number }[]
): Map<string, Record<string, number>> {
  const by = new Map<string, Record<string, number>>();
  for (const r of rows) {
    if (!r.user_id) continue;
    const cur = by.get(r.user_id) ?? {};
    cur[r.src] = (cur[r.src] ?? 0) + (Number(r.n) || 0);
    by.set(r.user_id, cur);
  }
  return by;
}

/**
 * One row per PERSON, busiest first, every signed-up person included.
 *
 * A person with nothing at all still gets a row on purpose: "signed up and
 * never used anything" is the single most actionable thing on this screen, and
 * dropping them because they have no counts would hide exactly the people worth
 * knowing about.
 */
export function buildPersonRows(
  people: PersonBase[],
  allTime: { user_id: string; src: string; n: number }[],
  windowed: { user_id: string; src: string; n: number }[],
  lastActive: { user_id: string; last_active: string | null }[],
  members: { couple_id: string; members: number; names?: string | null }[],
  sources: readonly string[]
): PersonUsageRow[] {
  const allBy = tally(allTime);
  const winBy = tally(windowed);
  const lastBy = new Map(lastActive.map((r) => [r.user_id, r.last_active]));
  const namesByCouple = new Map(
    members.map((m) => [
      m.couple_id,
      String(m.names ?? '')
        .split(NAME_DELIM)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' + '),
    ])
  );

  return people
    .map((p) => {
      const rawAll = allBy.get(p.id) ?? {};
      const rawWin = winBy.get(p.id) ?? {};
      const counts: Record<string, number> = {};
      const windowCounts: Record<string, number> = {};
      let total = 0;
      let windowTotal = 0;
      let featuresUsed = 0;
      for (const src of sources) {
        const a = rawAll[src] ?? 0;
        const w = rawWin[src] ?? 0;
        counts[src] = a;
        windowCounts[src] = w;
        total += a;
        windowTotal += w;
        if (a > 0) featuresUsed += 1;
      }
      return {
        id: p.id.slice(0, 8),
        name: p.display_name,
        coupleId: p.couple_id ? p.couple_id.slice(0, 8) : null,
        coupleName: (p.couple_id && namesByCouple.get(p.couple_id)) || '',
        counts,
        total,
        windowCounts,
        windowTotal,
        featuresUsed,
        lastActive: lastBy.get(p.id) ?? null,
      };
    })
    .sort((a, b) => b.total - a.total || (b.lastActive ?? '').localeCompare(a.lastActive ?? ''));
}

/**
 * Adoption per feature: how many DISTINCT people have ever used each one, and
 * how many used it inside the window.
 *
 * Distinct people, not row counts, because that is the question a feature owner
 * actually has. Chat produces thousands of rows from the same two people; a
 * feature used once each by everybody is doing better than one hammered by a
 * single power user, and a raw total says the opposite.
 */
export function featureAdoption(
  rows: PersonUsageRow[],
  sources: readonly string[]
): { src: string; users: number; windowUsers: number; total: number }[] {
  return sources
    .map((src) => ({
      src,
      users: rows.filter((r) => (r.counts[src] ?? 0) > 0).length,
      windowUsers: rows.filter((r) => (r.windowCounts[src] ?? 0) > 0).length,
      total: rows.reduce((sum, r) => sum + (r.counts[src] ?? 0), 0),
    }))
    .sort((a, b) => b.users - a.users || b.total - a.total);
}

/**
 * How many spaces did anything at all since `sinceISO`. Derived from the
 * last-active rows we already have rather than its own UNION query, so it stays
 * in step with whatever sources feed that query.
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

/**
 * Content totals, largest first, zeroes dropped. Chat dwarfs everything else
 * (two thirds of all rows in practice), so the screen scales these against the
 * LARGEST bar rather than the sum, or every other source is an invisible sliver.
 */
export function contentMix(totals: Record<string, number>, sources: readonly string[]): { src: string; n: number }[] {
  return sources
    .map((src) => ({ src, n: Number(totals[src] ?? 0) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
}
