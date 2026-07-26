/**
 * Picture Night: the rules of the shared movie riddle, with no database and no
 * request object, so every one of them is unit tested under plain node.
 *
 * The shape deliberately mirrors This-or-That's split (`game-rounds.ts`): the
 * route, the Home aggregate and the tests all need the same answers about a
 * board, and none of them should have to spin up a DB to reason about it.
 *
 * HOW THIS GAME DIFFERS FROM This-or-That, structurally: This-or-That hides each
 * partner's pick until both have played. This board is the opposite, SHARED and
 * VISIBLE from the first guess, two people leaning over one crossword. So there
 * is no "reveal" gate here, and nothing is stripped server side before both have
 * acted. The only end states are solved and out of attempts.
 */

/** Attempts are shared BETWEEN the two of you, not each. Scarcity is what makes it joint. */
export const MAX_ATTEMPTS = 7;

/** Two puzzles a day. Round 1 and round 2 of the same date, both open at once. */
export const ROUNDS_PER_DAY = 2;

/**
 * A failed guess at these counts unlocks one extra fact. Chosen to match the
 * reference game's own lifelines, and late enough that the shared budget still
 * does the work: by the 4th guess a couple has spent more than half their pool.
 */
export const HINT_AFTER = [4, 6] as const;

/** A year this far off still reads as "warm", not a hit. */
const YEAR_NEAR = 5;

export interface Movie {
  id: string;
  title: string;
  year: number;
  genres: string[];
  director: string[];
  cast: string[];
}

export type TileState = 'hit' | 'near' | 'miss';

export interface Tile {
  key: 'year' | 'genre' | 'cast' | 'director';
  state: TileState;
  /** What the guess itself said, always shown so the board reads as a record. */
  value: string;
  /** The parts that overlap with the mystery, for a `near`/`hit` tile. */
  shared: string[];
  /** Only on the year tile: is the mystery later ('up') or earlier ('down')? */
  direction?: 'up' | 'down';
}

const norm = (s: string) => s.trim().toLowerCase();

/** Case and whitespace insensitive overlap, returning the GUESS's spelling. */
function overlap(guess: string[], mystery: string[]): string[] {
  const want = new Set(mystery.map(norm));
  return guess.filter((g) => want.has(norm(g)));
}

/**
 * One guess compared against the mystery, as the row of tiles the board draws.
 *
 * Four tiles, not the six in the reference game: this dataset carries year,
 * genre, cast and director and nothing else. Production house and music
 * director are simply not in the data, and a fabricated attribute would break
 * the puzzle silently rather than merely looking wrong.
 */
export function compareMovies(guess: Movie, mystery: Movie): Tile[] {
  const yearDiff = mystery.year - guess.year;
  const yearState: TileState = yearDiff === 0 ? 'hit' : Math.abs(yearDiff) <= YEAR_NEAR ? 'near' : 'miss';

  const genreShared = overlap(guess.genres, mystery.genres);
  // A genre list is a set, so "same set" is a hit and "some overlap" is warm.
  const genreState: TileState =
    genreShared.length === guess.genres.length && guess.genres.length === mystery.genres.length
      ? 'hit'
      : genreShared.length > 0
        ? 'near'
        : 'miss';

  // Two or more shared faces is a real signal (an ensemble in common); one is
  // a nudge, since a single prolific actor appears in a hundred of these.
  const castShared = overlap(guess.cast, mystery.cast);
  const castState: TileState = castShared.length >= 2 ? 'hit' : castShared.length === 1 ? 'near' : 'miss';

  // Directors can be a pair ("Gayatri, Pushkar"), so this is a set too.
  const dirShared = overlap(guess.director, mystery.director);
  const dirState: TileState =
    dirShared.length === guess.director.length && guess.director.length === mystery.director.length
      ? 'hit'
      : dirShared.length > 0
        ? 'near'
        : 'miss';

  return [
    {
      key: 'year',
      state: yearState,
      value: String(guess.year),
      shared: [],
      ...(yearState === 'hit' ? {} : { direction: yearDiff > 0 ? ('up' as const) : ('down' as const) }),
    },
    { key: 'genre', state: genreState, value: guess.genres.join(', '), shared: genreShared },
    { key: 'cast', state: castState, value: guess.cast.join(', '), shared: castShared },
    { key: 'director', state: dirState, value: guess.director.join(', '), shared: dirShared },
  ];
}

export interface GuessRow {
  movie_id: string;
  user_id: string;
  correct: boolean;
  created_at: string;
}

export interface BoardState {
  solved: boolean;
  /** Out of attempts without solving it. */
  lost: boolean;
  /** Either end state: the board settles into its reveal. */
  over: boolean;
  attemptsUsed: number;
  attemptsLeft: number;
  /** How many hints the couple has earned so far (0..HINT_AFTER.length). */
  hintsUnlocked: number;
  /** Who landed the winning guess, for the reveal line. Null unless solved. */
  solvedBy: string | null;
}

/**
 * The whole board state, DERIVED from the guess rows every read.
 *
 * Nothing about "solved" or "attempts left" is stored: same reasoning as
 * `computeStreak`, which was rewritten this way after an incremental counter
 * drifted and showed people the wrong number. A count that is recomputed from
 * its own source of truth cannot disagree with it.
 */
export function boardStateFor(guesses: GuessRow[]): BoardState {
  const winner = guesses.find((g) => g.correct) ?? null;
  const solved = !!winner;
  // Guesses after a win cannot happen (the route refuses them), but if one ever
  // did it must not consume the budget of an already finished board.
  const attemptsUsed = Math.min(guesses.length, MAX_ATTEMPTS);
  const lost = !solved && attemptsUsed >= MAX_ATTEMPTS;
  return {
    solved,
    lost,
    over: solved || lost,
    attemptsUsed,
    attemptsLeft: Math.max(0, MAX_ATTEMPTS - attemptsUsed),
    hintsUnlocked: solved ? 0 : HINT_AFTER.filter((n) => attemptsUsed >= n).length,
    solvedBy: winner ? winner.user_id : null,
  };
}

export interface Hint {
  label: string;
  value: string;
}

/**
 * The facts unlocked so far. Deliberately narrowing rather than giving the
 * answer away: a decade, then one genre. Never the director or a cast member,
 * either of which usually IS the answer for a Bollywood film.
 */
export function hintsFor(mystery: Movie, unlocked: number): Hint[] {
  const all: Hint[] = [
    { label: 'The decade', value: `${Math.floor(mystery.year / 10) * 10}s` },
    { label: 'One genre', value: mystery.genres[0] ?? 'unknown' },
  ];
  return all.slice(0, Math.max(0, Math.min(unlocked, all.length)));
}

/**
 * Which movies are the mystery on a given date, one index per round.
 *
 * Same spirit as This-or-That's `poolIndexFor`, but SEQUENTIAL rather than a
 * bare hash-mod: a hash collides, and a repeat inside a few weeks is far more
 * noticeable when the puzzle takes ten minutes than when it takes two taps.
 * Walking the pool in a fixed, shuffled order (the caller orders by a stable
 * hash of the movie id) means every film is used once before any repeats.
 *
 * Indexes are derived from the day number, so a past date always resolves to
 * the same films. That is what makes the calendar archive possible at all.
 */
export function puzzleIndexesFor(dateStr: string, poolSize: number): number[] {
  if (poolSize <= 0) return [];
  const day = dayNumber(dateStr);
  if (day === null) return [];
  const out: number[] = [];
  for (let r = 0; r < ROUNDS_PER_DAY; r++) {
    out.push(((day * ROUNDS_PER_DAY + r) % poolSize + poolSize) % poolSize);
  }
  return out;
}

/** Whole days since the epoch for a YYYY-MM-DD string, or null if unparseable. */
export function dayNumber(dateStr: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.slice(0, 10));
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (!Number.isFinite(t)) return null;
  return Math.floor(t / 86_400_000);
}

/**
 * A stable ordering key for the pool. Any deterministic scramble works; what
 * matters is that it never changes, or every past date in the calendar would
 * silently start resolving to a different film.
 */
export function poolSortKey(movieId: string): number {
  let h = 2166136261;
  for (let i = 0; i < movieId.length; i++) {
    h ^= movieId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A date is playable if it is today or in the past. No peeking ahead. */
export function isPlayableDate(dateStr: string, todayUTC: string): boolean {
  const d = dayNumber(dateStr);
  const t = dayNumber(todayUTC);
  if (d === null || t === null) return false;
  return d <= t;
}
