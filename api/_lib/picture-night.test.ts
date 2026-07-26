import { describe, expect, it } from 'vitest';
import {
  boardStateFor,
  compareMovies,
  dayNumber,
  hintsFor,
  isPlayableDate,
  MAX_ATTEMPTS,
  poolSortKey,
  puzzleIndexesFor,
  type Movie,
} from './picture-night';

const mystery: Movie = {
  id: 'm1',
  title: 'Jawan',
  year: 2023,
  genres: ['Action', 'Thriller'],
  director: ['Atlee'],
  cast: ['Shah Rukh Khan', 'Nayanthara', 'Vijay Sethupathi', 'Deepika Padukone'],
};

const movie = (over: Partial<Movie>): Movie => ({ ...mystery, id: 'g', ...over });

const tile = (g: Movie, key: string) => compareMovies(g, mystery).find((t) => t.key === key)!;

describe('compareMovies — year', () => {
  it('is a hit on the same year, with no direction to give away', () => {
    const t = tile(movie({ year: 2023 }), 'year');
    expect(t.state).toBe('hit');
    expect(t.direction).toBeUndefined();
  });

  it('is warm within five years and points the right way', () => {
    expect(tile(movie({ year: 2020 }), 'year')).toMatchObject({ state: 'near', direction: 'up' });
    expect(tile(movie({ year: 2026 }), 'year')).toMatchObject({ state: 'near', direction: 'down' });
  });

  it('is a miss further out, still pointing the right way', () => {
    expect(tile(movie({ year: 1995 }), 'year')).toMatchObject({ state: 'miss', direction: 'up' });
  });
});

describe('compareMovies — genre', () => {
  it('is a hit only when the whole set matches', () => {
    expect(tile(movie({ genres: ['Action', 'Thriller'] }), 'genre').state).toBe('hit');
  });

  it('is warm on partial overlap, and names what overlapped', () => {
    const t = tile(movie({ genres: ['Action', 'Comedy'] }), 'genre');
    expect(t.state).toBe('near');
    expect(t.shared).toEqual(['Action']);
  });

  it('a subset is warm, not a hit: fewer genres is not the same set', () => {
    expect(tile(movie({ genres: ['Action'] }), 'genre').state).toBe('near');
  });

  it('is a miss with nothing in common', () => {
    expect(tile(movie({ genres: ['Musical'] }), 'genre').state).toBe('miss');
  });

  it('ignores case and stray spacing', () => {
    expect(tile(movie({ genres: ['  action ', 'THRILLER'] }), 'genre').state).toBe('hit');
  });
});

describe('compareMovies — cast', () => {
  it('two or more shared faces is a hit', () => {
    const t = tile(movie({ cast: ['Shah Rukh Khan', 'Nayanthara', 'X', 'Y'] }), 'cast');
    expect(t.state).toBe('hit');
    expect(t.shared).toEqual(['Shah Rukh Khan', 'Nayanthara']);
  });

  it('one shared face is only warm, since a prolific actor is in a hundred of these', () => {
    expect(tile(movie({ cast: ['Shah Rukh Khan', 'A', 'B', 'C'] }), 'cast').state).toBe('near');
  });

  it('is a miss with no one in common', () => {
    expect(tile(movie({ cast: ['A', 'B', 'C', 'D'] }), 'cast').state).toBe('miss');
  });
});

describe('compareMovies — director', () => {
  it('is a hit on the same director', () => {
    expect(tile(movie({ director: ['Atlee'] }), 'director').state).toBe('hit');
  });

  it('handles a directing pair as a set', () => {
    const pair: Movie = { ...mystery, director: ['Gayatri', 'Pushkar'] };
    expect(compareMovies({ ...pair, id: 'g' }, pair).find((t) => t.key === 'director')!.state).toBe('hit');
    const partial = compareMovies({ ...pair, id: 'g', director: ['Gayatri', 'Someone'] }, pair);
    expect(partial.find((t) => t.key === 'director')!.state).toBe('near');
  });

  it('is a miss on a different director', () => {
    expect(tile(movie({ director: ['Karan Johar'] }), 'director').state).toBe('miss');
  });
});

describe('compareMovies — shape', () => {
  it('returns exactly the four attributes this dataset actually carries', () => {
    expect(compareMovies(movie({}), mystery).map((t) => t.key)).toEqual(['year', 'genre', 'cast', 'director']);
  });

  it('a correct guess lights every tile', () => {
    expect(compareMovies({ ...mystery, id: 'g' }, mystery).every((t) => t.state === 'hit')).toBe(true);
  });
});

const g = (over: Partial<{ movie_id: string; user_id: string; correct: boolean }> = {}) => ({
  movie_id: 'x',
  user_id: 'user-A',
  correct: false,
  created_at: '2026-07-26T10:00:00.000Z',
  ...over,
});

describe('boardStateFor', () => {
  it('an empty board has the whole shared budget', () => {
    expect(boardStateFor([])).toMatchObject({
      solved: false,
      lost: false,
      over: false,
      attemptsUsed: 0,
      attemptsLeft: MAX_ATTEMPTS,
      hintsUnlocked: 0,
    });
  });

  it('counts BOTH partners guesses against one shared pool', () => {
    const s = boardStateFor([g({ user_id: 'user-A' }), g({ user_id: 'user-B' }), g({ user_id: 'user-A' })]);
    expect(s.attemptsUsed).toBe(3);
    expect(s.attemptsLeft).toBe(MAX_ATTEMPTS - 3);
  });

  it('solving records who landed it, and ends the board', () => {
    const s = boardStateFor([g(), g({ user_id: 'user-B', correct: true })]);
    expect(s).toMatchObject({ solved: true, over: true, lost: false, solvedBy: 'user-B' });
  });

  it('running out of attempts loses rather than solving', () => {
    const s = boardStateFor(Array.from({ length: MAX_ATTEMPTS }, () => g()));
    expect(s).toMatchObject({ solved: false, lost: true, over: true, attemptsLeft: 0 });
  });

  it('unlocks a hint after the 4th and 6th failed guess, not before', () => {
    const misses = (n: number) => boardStateFor(Array.from({ length: n }, () => g())).hintsUnlocked;
    expect(misses(3)).toBe(0);
    expect(misses(4)).toBe(1);
    expect(misses(5)).toBe(1);
    expect(misses(6)).toBe(2);
  });

  it('offers no hints once it is solved', () => {
    const rows = [...Array.from({ length: 5 }, () => g()), g({ correct: true })];
    expect(boardStateFor(rows).hintsUnlocked).toBe(0);
  });

  it('never lets a stray extra row push attempts past the budget', () => {
    const s = boardStateFor(Array.from({ length: MAX_ATTEMPTS + 3 }, () => g()));
    expect(s.attemptsUsed).toBe(MAX_ATTEMPTS);
    expect(s.attemptsLeft).toBe(0);
  });
});

describe('hintsFor', () => {
  it('narrows rather than giving it away: a decade, then one genre', () => {
    expect(hintsFor(mystery, 2)).toEqual([
      { label: 'The decade', value: '2020s' },
      { label: 'One genre', value: 'Action' },
    ]);
  });

  it('never reveals the director or a cast member, which usually IS the answer', () => {
    const text = JSON.stringify(hintsFor(mystery, 2));
    expect(text).not.toContain('Atlee');
    expect(text).not.toContain('Shah Rukh Khan');
  });

  it('gives nothing at zero and never more than it has', () => {
    expect(hintsFor(mystery, 0)).toEqual([]);
    expect(hintsFor(mystery, 99)).toHaveLength(2);
  });
});

describe('puzzleIndexesFor', () => {
  it('gives two puzzles a day', () => {
    expect(puzzleIndexesFor('2026-07-26', 100)).toHaveLength(2);
  });

  it('is deterministic, which is what makes the calendar archive possible', () => {
    expect(puzzleIndexesFor('2026-07-26', 100)).toEqual(puzzleIndexesFor('2026-07-26', 100));
  });

  it("the day's two puzzles are different films", () => {
    const [a, b] = puzzleIndexesFor('2026-07-26', 100);
    expect(a).not.toBe(b);
  });

  it('walks the pool sequentially so nothing repeats until it is exhausted', () => {
    const size = 10;
    const seen = new Set<number>();
    for (const d of ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23', '2026-07-24']) {
      for (const i of puzzleIndexesFor(d, size)) seen.add(i);
    }
    // 5 days x 2 rounds = 10 distinct films out of a pool of 10.
    expect(seen.size).toBe(size);
  });

  it('survives a pool of one without dividing by zero', () => {
    expect(puzzleIndexesFor('2026-07-26', 1)).toEqual([0, 0]);
  });

  it('returns nothing for an empty pool or an unparseable date', () => {
    expect(puzzleIndexesFor('2026-07-26', 0)).toEqual([]);
    expect(puzzleIndexesFor('not-a-date', 100)).toEqual([]);
  });
});

describe('dayNumber / poolSortKey / isPlayableDate', () => {
  it('counts whole UTC days and rejects junk', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('nope')).toBeNull();
  });

  it('poolSortKey is stable, or every past date would resolve to a new film', () => {
    expect(poolSortKey('tt15354916')).toBe(poolSortKey('tt15354916'));
    expect(poolSortKey('tt15354916')).not.toBe(poolSortKey('tt15748830'));
  });

  it('today and the past are playable, the future is not', () => {
    expect(isPlayableDate('2026-07-26', '2026-07-26')).toBe(true);
    expect(isPlayableDate('2026-07-25', '2026-07-26')).toBe(true);
    expect(isPlayableDate('2026-07-27', '2026-07-26')).toBe(false);
  });
});
