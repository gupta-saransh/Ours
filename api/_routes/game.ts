import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, HttpError } from '../_lib/respond';

/**
 * This-or-That: the daily two-tap game. One pair of options per day (static
 * pool, deterministic by date, same trick as the daily prompt). Each partner
 * picks their OWN answer and guesses their PARTNER's. Nothing is revealed until
 * both have played (same mutual-reveal shape as prompts); then you see their
 * pick, whether you guessed right, and whether they guessed you right. A
 * correct guess earns relationship points (see home.ts).
 *
 *   GET  /api/game/today            today's pair + your state (+ reveal if both in)
 *   POST /api/game/today { pick, guess }   play (once per day)
 *
 * The option text is never stored; only 'a'/'b' letters land in the DB, so
 * there is nothing sensitive to encrypt.
 */

export interface GamePair {
  a: string;
  b: string;
}

// Keep every pair light and playable in two seconds. No heavy either/ors.
export const GAME_POOL: GamePair[] = [
  { a: 'Coffee', b: 'Chai' },
  { a: 'Sunrise', b: 'Sunset' },
  { a: 'Mountains', b: 'Ocean' },
  { a: 'Cook at home', b: 'Eat out' },
  { a: 'Movie night', b: 'Long walk' },
  { a: 'Sweet', b: 'Savory' },
  { a: 'Window seat', b: 'Aisle seat' },
  { a: 'Early bird', b: 'Night owl' },
  { a: 'Texting', b: 'Calling' },
  { a: 'Beach holiday', b: 'City holiday' },
  { a: 'Rain', b: 'Snow' },
  { a: 'Books', b: 'Podcasts' },
  { a: 'Dancing', b: 'Singing' },
  { a: 'Big party', b: 'Quiet dinner' },
  { a: 'Pancakes', b: 'Waffles' },
  { a: 'Dogs', b: 'Cats' },
  { a: 'Summer', b: 'Winter' },
  { a: 'Plan everything', b: 'Wing it' },
  { a: 'Rewatch a favorite', b: 'Something new' },
  { a: 'Breakfast in bed', b: 'Midnight snack' },
  { a: 'Road trip', b: 'Flight somewhere' },
  { a: 'Camping', b: 'Fancy hotel' },
  { a: 'Ice cream', b: 'Cake' },
  { a: 'Museums', b: 'Markets' },
  { a: 'Handwritten note', b: 'Voice message' },
  { a: 'Stay in pajamas', b: 'Dress up' },
  { a: 'Spicy', b: 'Mild' },
  { a: 'Board games', b: 'Video games' },
  { a: 'Stargazing', b: 'People watching' },
  { a: 'Old songs', b: 'New releases' },
  { a: 'Tea in silence', b: 'Talk over coffee' },
  { a: 'Surprise gifts', b: 'Wishlist gifts' },
  { a: 'Slow mornings', b: 'Slow evenings' },
  { a: 'Photos of places', b: 'Photos of people' },
  { a: 'One long trip', b: 'Many small trips' },
  { a: 'Homemade pizza', b: 'Ordered pizza' },
  { a: 'Bath', b: 'Shower' },
  { a: 'Comedy', b: 'Thriller' },
  { a: 'Picnic', b: 'Rooftop' },
  { a: 'First to apologize', b: 'First to laugh' },
  { a: 'Save it', b: 'Spend it' },
  { a: 'Balcony plants', b: 'Fresh flowers' },
  { a: 'Their hoodie', b: 'Own blanket' },
  { a: 'Hold hands', b: 'Arm around' },
  { a: 'Dessert first', b: 'Dessert last' },
  { a: 'Quiet beach', b: 'Busy boardwalk' },
  { a: 'Learn together', b: 'Teach each other' },
  { a: 'Sleep in', b: 'Up with the sun' },
];

function poolIndexFor(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
  return h % GAME_POOL.length;
}

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export function todaysGame(): { game_date: string } & GamePair {
  const game_date = todayUTC();
  return { game_date, ...GAME_POOL[poolIndexFor(game_date)] };
}

interface AnswerRow {
  user_id: string;
  pick: 'a' | 'b';
  guess: 'a' | 'b';
}

/**
 * The game state one partner is allowed to see. Before both have played, the
 * partner's row is reduced to a boolean; picks and guesses stay server-side
 * (same privacy shape as prompt answers).
 */
export async function gameStateFor(coupleId: string, userId: string) {
  const game = todaysGame();
  const rows = await q<AnswerRow>(
    `SELECT user_id, pick, guess FROM daily_game_answers WHERE couple_id = $1 AND game_date = $2`,
    [coupleId, game.game_date]
  ).catch(() => [] as AnswerRow[]); // pre-v16 deploy: degrade to "not played"
  const mine = rows.find((r) => r.user_id === userId) ?? null;
  const theirs = rows.find((r) => r.user_id !== userId) ?? null;
  const both = !!mine && !!theirs;
  return {
    game,
    played: !!mine,
    partnerPlayed: !!theirs,
    mine: mine ? { pick: mine.pick, guess: mine.guess } : null,
    reveal: both
      ? {
          partnerPick: theirs!.pick,
          iGuessedRight: mine!.guess === theirs!.pick,
          theyGuessedRight: theirs!.guess === mine!.pick,
        }
      : null,
  };
}

const LETTERS = new Set(['a', 'b']);

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;

  if (req.method === 'GET') {
    res.status(200).json(await gameStateFor(cid, user.id));
    return;
  }

  // POST: play once for today.
  const pick = String(req.body?.pick ?? '');
  const guess = String(req.body?.guess ?? '');
  if (!LETTERS.has(pick) || !LETTERS.has(guess)) throw new HttpError(400, 'Pick and guess must be a or b');

  const game = todaysGame();
  const inserted = await one(
    `INSERT INTO daily_game_answers (couple_id, user_id, game_date, pick, guess)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (couple_id, user_id, game_date) DO NOTHING
     RETURNING id`,
    [cid, user.id, game.game_date, pick, guess]
  );
  if (!inserted) throw new HttpError(409, 'You already played today. Tomorrow brings a new one.');

  const state = await gameStateFor(cid, user.id);
  // Tell the partner something changed. No picks in the event: the first
  // answerer's choice must stay hidden until the reveal, and after the reveal
  // clients refetch their own view anyway.
  await publish(cid, 'game.updated', { game_date: game.game_date, by: user.id, revealed: !!state.reveal });
  if (state.reveal) {
    // The FIRST answerer gets pulled back for the payoff. Generic on purpose.
    await notify(cid, user.id, 'game', `${user.display_name} played today's This or That. See how you both chose`);
  }
  res.status(201).json(state);
});
