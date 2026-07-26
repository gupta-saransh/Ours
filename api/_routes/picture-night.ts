import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, HttpError } from '../_lib/respond';
import {
  boardStateFor,
  compareMovies,
  hintsFor,
  isPlayableDate,
  MAX_ATTEMPTS,
  poolSortKey,
  puzzleIndexesFor,
  ROUNDS_PER_DAY,
  type GuessRow,
  type Movie,
} from '../_lib/picture-night';

/**
 * Picture Night: one shared movie riddle board per couple, twice a day.
 *
 *   GET  /api/picture-night?date=YYYY-MM-DD   both of the day's boards + the month's marks
 *   GET  /api/picture-night?search=...        autocomplete over the whole catalogue
 *   POST /api/picture-night { date, round, movieId }   submit a shared guess
 *
 * DELIBERATELY NOT This-or-That's privacy shape. That game strips each partner's
 * pick until both have played; this board is SHARED and VISIBLE, so a guess and
 * its tiles publish to the couple channel immediately (`riddle.guessed`) and
 * nothing is withheld. Two people leaning over one crossword, not two people
 * answering privately.
 *
 * The mystery film's identity is the ONE thing held back: it is never in a
 * response until the board is over, or the answer would be one devtools tab
 * away. Tiles are computed server side for the same reason.
 */

/** Rows come back with JSONB columns already parsed by `pg`. */
interface MovieRow {
  id: string;
  title: string;
  year: number;
  genres: string[];
  director: string[];
  cast_members: string[];
}

const toMovie = (r: MovieRow): Movie => ({
  id: r.id,
  title: r.title,
  year: Number(r.year),
  genres: r.genres ?? [],
  director: r.director ?? [],
  cast: r.cast_members ?? [],
});

/** What a guess looks like to the board: the film, plus how it compared. */
const publicGuess = (m: Movie, mystery: Movie, g: GuessRow) => ({
  movieId: m.id,
  title: m.title,
  year: m.year,
  by: g.user_id,
  correct: g.correct,
  created_at: g.created_at,
  tiles: compareMovies(m, mystery),
});

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The eligible pool in ONE fixed order, so a given date always resolves to the
 * same films. Ordered in JS by `poolSortKey` rather than in SQL: the ordering
 * must never change, and a database collation is not a promise this code
 * controls. Ids only, so this stays a small query however big the catalogue is.
 */
async function eligibleIds(): Promise<string[]> {
  const rows = await q<{ id: string }>(`SELECT id::STRING AS id FROM movies WHERE eligible = true`);
  return rows.map((r) => r.id).sort((a, b) => poolSortKey(a) - poolSortKey(b) || a.localeCompare(b));
}

async function moviesByIds(ids: string[]): Promise<Map<string, Movie>> {
  if (ids.length === 0) return new Map();
  const rows = await q<MovieRow>(
    `SELECT id::STRING AS id, title, year, genres, director, cast_members
     FROM movies WHERE id = ANY($1::UUID[])`,
    [ids]
  );
  return new Map(rows.map((r) => [r.id, toMovie(r)]));
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;

  // ---- Autocomplete -------------------------------------------------------
  // Against the catalogue only, never free text, so every guess is a real film
  // and a typo can never be scored as a miss. The whole catalogue is
  // searchable, not just the eligible pool: a wrong guess is still a fair move.
  if (req.method === 'GET' && typeof req.query.search === 'string') {
    const term = req.query.search.trim();
    if (term.length < 2) {
      res.status(200).json({ results: [] });
      return;
    }
    const rows = await q<{ id: string; title: string; year: number }>(
      `SELECT id::STRING AS id, title, year FROM movies
       WHERE title ILIKE $1 ORDER BY (title ILIKE $2) DESC, year DESC LIMIT 12`,
      [`%${term}%`, `${term}%`]
    );
    res.status(200).json({
      // The year rides along on purpose: 37 titles in this catalogue are
      // duplicated (Don three times), and a bare title is ambiguous to pick.
      results: rows.map((r) => ({ id: r.id, title: r.title, year: Number(r.year) })),
    });
    return;
  }

  const dateStr =
    typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date)
      ? req.query.date
      : typeof req.body?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.body.date)
        ? req.body.date
        : todayUTC();

  const today = todayUTC();
  // A future date has no board. Not a privacy matter so much as a coherence one:
  // tomorrow's film is decided by arithmetic, so letting it be fetched would
  // simply hand it over.
  if (!isPlayableDate(dateStr, today)) throw new HttpError(400, 'That day has not arrived yet');

  const pool = await eligibleIds();
  if (pool.length === 0) throw new HttpError(503, 'No films are loaded yet');
  const mysteryIds = puzzleIndexesFor(dateStr, pool.length).map((i) => pool[i]);

  // ---- Submit a guess -----------------------------------------------------
  if (req.method === 'POST') {
    const round = Number(req.body?.round);
    const movieId = String(req.body?.movieId ?? '');
    if (!Number.isInteger(round) || round < 1 || round > ROUNDS_PER_DAY) {
      throw new HttpError(400, 'Which round?');
    }
    if (!movieId) throw new HttpError(400, 'Pick a film from the list');

    const mysteryId = mysteryIds[round - 1];
    const existing = await q<GuessRow>(
      `SELECT movie_id::STRING AS movie_id, user_id::STRING AS user_id, correct, created_at::STRING AS created_at
       FROM picture_night_guesses
       WHERE couple_id = $1 AND puzzle_date = $2 AND round = $3 ORDER BY created_at ASC`,
      [cid, dateStr, round]
    );
    const before = boardStateFor(existing);
    // Both guards matter with two people on one board: your partner may have
    // solved it, or spent the last attempt, between your screen rendering and
    // your tap landing.
    if (before.over) throw new HttpError(409, before.solved ? 'You two already got this one' : 'No attempts left');
    if (existing.some((g) => g.movie_id === movieId)) throw new HttpError(409, 'Already guessed that one');

    const guessed = (await moviesByIds([movieId, mysteryId])).get(movieId);
    const mystery = (await moviesByIds([mysteryId])).get(mysteryId);
    if (!guessed || !mystery) throw new HttpError(400, 'That film is not in the list');

    const correct = guessed.id === mystery.id;
    const inserted = await one<{ created_at: string }>(
      `INSERT INTO picture_night_guesses (couple_id, user_id, puzzle_date, round, movie_id, correct)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING created_at::STRING AS created_at`,
      [cid, user.id, dateStr, round, movieId, correct]
    );

    const row: GuessRow = {
      movie_id: movieId,
      user_id: user.id,
      correct,
      created_at: inserted?.created_at ?? new Date().toISOString(),
    };
    const after = boardStateFor([...existing, row]);
    const payload = publicGuess(guessed, mystery, row);

    // The board is shared, so the guess and its tiles go out in full. This is
    // the deliberate opposite of `game.updated`, which carries no picks.
    await publish(cid, 'riddle.guessed', {
      date: dateStr,
      round,
      guess: payload,
      state: after,
      // Only once it is over, and then to both of them at the same moment.
      answer: after.over ? { title: mystery.title, year: mystery.year } : null,
    }).catch(() => {});

    // A guess is a live, visible act, so the partner watching needs nothing.
    // One quiet bell row when the board FINISHES is the whole notification
    // budget for this game: a row per guess would flood the pane.
    if (after.over) {
      await notify(cid, user.id, 'game', after.solved
        ? `You two solved tonight's mystery movie`
        : `Tonight's mystery movie got away from you two`
      ).catch(() => {});
    }

    res.status(201).json({
      guess: payload,
      state: after,
      hints: hintsFor(mystery, after.hintsUnlocked),
      answer: after.over ? { title: mystery.title, year: mystery.year } : null,
    });
    return;
  }

  // ---- The day's boards, plus the month's marks for the calendar ----------
  const allGuesses = await q<GuessRow & { round: number }>(
    `SELECT round, movie_id::STRING AS movie_id, user_id::STRING AS user_id, correct,
            created_at::STRING AS created_at
     FROM picture_night_guesses
     WHERE couple_id = $1 AND puzzle_date = $2 ORDER BY created_at ASC`,
    [cid, dateStr]
  );

  const guessedIds = allGuesses.map((g) => g.movie_id);
  const films = await moviesByIds([...new Set([...guessedIds, ...mysteryIds])]);

  const boards = mysteryIds.map((mysteryId, i) => {
    const round = i + 1;
    const mystery = films.get(mysteryId)!;
    const rows = allGuesses.filter((g) => Number(g.round) === round);
    const state = boardStateFor(rows);
    return {
      round,
      state,
      guesses: rows.map((g) => publicGuess(films.get(g.movie_id)!, mystery, g)).filter(Boolean),
      hints: hintsFor(mystery, state.hintsUnlocked),
      // Withheld until the board is over. The client never learns the answer early.
      answer: state.over ? { title: mystery.title, year: mystery.year } : null,
    };
  });

  // One grouped query for the whole month's calendar marks, not one per day.
  const month = dateStr.slice(0, 7);
  const marks = await q<{ day: string; round: number; solved: boolean; n: number }>(
    `SELECT puzzle_date::STRING AS day, round,
            bool_or(correct) AS solved, count(*)::int AS n
     FROM picture_night_guesses
     WHERE couple_id = $1 AND puzzle_date >= ($2 || '-01')::DATE
       AND puzzle_date < (($2 || '-01')::DATE + INTERVAL '1 month')
     GROUP BY puzzle_date, round`,
    [cid, month]
  );

  res.status(200).json({
    date: dateStr,
    today,
    maxAttempts: MAX_ATTEMPTS,
    boards,
    month,
    marks: marks.map((m) => ({
      day: m.day,
      round: Number(m.round),
      solved: !!m.solved,
      guesses: Number(m.n),
    })),
  });
});
