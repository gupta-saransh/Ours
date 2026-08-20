/**
 * Picking the day's question so it does not repeat until it has to.
 *
 * THE BUG THIS REPLACES: both the daily prompt and This-or-That picked with
 * `hash(date) % pool.length`. A hash does not distribute over a small pool the
 * way people assume: it is a birthday-problem draw with replacement, so with
 * ~100 entries you see a repeat within a couple of weeks, and some entries never
 * come up at all. Players read that as "it is giving us questions we already
 * answered", which is exactly what it is doing.
 *
 * THE FIX: walk the pool SEQUENTIALLY through ONE fixed shuffled order, indexed
 * by the day number. Every entry appears exactly once before any entry appears
 * twice, so a pool of N lasts N draws with no repeats, guaranteed rather than
 * merely likely. Picture Night already does this (`puzzleIndexesFor`) for the
 * same reason; this generalises it so the prompt and the game share one tested
 * implementation.
 *
 * WHY THE ORDER IS FIXED RATHER THAN RESHUFFLED EACH LAP. Reshuffling per lap
 * is the obvious "don't be predictable" improvement and it is wrong: the
 * guarantee people actually care about is over a SLIDING window (any N draws in
 * a row are distinct), not over laps aligned to some arbitrary epoch. Two
 * different permutations either side of a lap boundary can hand back the same
 * entry a few days apart, which is precisely the complaint this module exists
 * to fix. One fixed order walked cyclically makes a repeat inside N draws
 * arithmetically impossible. Predictability across laps costs nothing here: a
 * lap is months long, and nobody is memorising the running order.
 *
 * `dayNumber` is duplicated from picture-night.ts on purpose: that module's
 * output IS its puzzle schedule, and its archive calendar has to keep resolving
 * every past date to the same films, so it is deliberately left untouched.
 */

/** Days since the epoch for a YYYY-MM-DD string, or null if it is not one. */
export function dayNumber(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.slice(0, 10));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 86_400_000);
}

/** FNV-1a, the same hash picture-night.ts uses for its pool ordering. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: small, fast, and deterministic for a given seed. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// One permutation per (size, salt), built once and reused. Small pools, so this
// costs nothing; it just avoids reshuffling on every draw.
const orderCache = new Map<string, number[]>();

/**
 * The fixed running order for a pool: a deterministic shuffle of 0..size-1.
 * Deterministic so the schedule is reproducible and testable; shuffled so
 * consecutive days are not simply the order somebody typed the list in.
 *
 * The order changes if the pool GROWS, which is intended: new entries have to
 * be dealt into the rotation somewhere, and reshuffling is how they get there
 * rather than all landing at the end.
 */
export function rotationOrder(size: number, salt: string): number[] {
  if (size <= 0) return [];
  const key = `${salt}:${size}`;
  const cached = orderCache.get(key);
  if (cached) return cached;

  const order = Array.from({ length: size }, (_, i) => i);
  const rand = seededRandom(hashString(key));
  // Fisher-Yates, back to front.
  for (let i = size - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  orderCache.set(key, order);
  return order;
}

/**
 * The pool indexes for one date. `count` is how many that day needs (1 for the
 * daily prompt, 2 for This-or-That's two rounds).
 *
 * Draws walk ONE continuous sequence, so the no-repeat guarantee holds across
 * days and across rounds within a day alike: any `size` consecutive draws are
 * distinct. Returns [] for an unparseable date or an empty pool rather than
 * guessing at one.
 */
export function rotationIndexes(dateStr: string, size: number, count: number, salt: string): number[] {
  const day = dayNumber(dateStr);
  if (day === null || size <= 0 || count <= 0) return [];

  const order = rotationOrder(size, salt);
  const out: number[] = [];
  for (let r = 0; r < count; r++) {
    // One shared sequence across every draw ever made, so position N and
    // position N+1 are always different entries (until the lap wraps).
    const seq = day * count + r;
    const pos = ((seq % size) + size) % size; // normalised for pre-epoch dates
    out.push(order[pos]);
  }
  return out;
}
