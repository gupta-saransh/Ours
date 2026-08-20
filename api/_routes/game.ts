import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { roundStateFor, type AnswerRow } from '../_lib/game-rounds';
import { route, HttpError } from '../_lib/respond';
import { rotationIndexes } from '../_lib/daily-rotation';

// The round rules now live in _lib/game-rounds.ts so the reminder cron can
// share them. Re-exported here because this module was their original home.
export { ROUND_TWO_DELAY_MS, hasUnplayedRound, roundStateFor } from '../_lib/game-rounds';

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

  // The quirkier half. Same two-second rule, but these are the ones that start
  // an argument you both enjoy, which is the point of the game.
  { a: 'Pineapple on pizza', b: 'Absolutely not' },
  { a: 'Toilet roll over', b: 'Toilet roll under' },
  { a: 'Ketchup in the fridge', b: 'Ketchup in the cupboard' },
  { a: 'Socks on', b: 'Socks off' },
  { a: 'Talk during films', b: 'Silence during films' },
  { a: 'Cold pizza', b: 'Reheated pizza' },
  { a: 'Reply instantly', b: 'Reply in three days' },
  { a: 'Voice note', b: 'Paragraph text' },
  { a: 'Crunchy', b: 'Smooth' },
  { a: 'Coriander, yes', b: 'Coriander, never' },
  { a: 'Sweet popcorn', b: 'Salty popcorn' },
  { a: 'Fizzy', b: 'Still' },
  { a: 'Window open', b: 'Window shut' },
  { a: 'Bed made', b: 'Bed unmade' },
  { a: 'Shoes at the door', b: 'Shoes wherever' },
  { a: 'Tidy as you go', b: 'Tidy at the end' },
  { a: 'Snooze five times', b: 'Up on the first alarm' },
  { a: 'Long shower', b: 'Quick shower' },
  { a: 'Playlist', b: 'Shuffle' },
  { a: 'Cash', b: 'Card' },
  { a: 'Keep the box', b: 'Bin the box' },
  { a: 'Early to the airport', b: 'Just in time' },
  { a: 'Front seat', b: 'Back seat' },
  { a: 'Take the stairs', b: 'Wait for the lift' },
  { a: 'Aeroplane nap', b: 'Aeroplane film' },
  { a: 'Read the ending first', b: 'Never spoil it' },
  { a: 'Same order every time', b: 'Try something different' },
  { a: 'Group photo', b: 'Candid photo' },
  { a: 'Karaoke', b: 'Not a chance' },
  { a: 'Sing in the shower', b: 'Sing in the car' },
  { a: 'Talk it out now', b: 'Sleep on it' },
  { a: 'Argue the point', b: 'Let it go' },
  { a: 'Open the present early', b: 'Wait for the day' },
  { a: 'Answer the phone', b: 'Let it ring' },
  { a: 'Handwrite the list', b: 'Notes on the phone' },
  { a: 'Big breakfast', b: 'Big dinner' },
  { a: 'Sunday roast', b: 'Sunday brunch' },
  { a: 'Hot sauce on everything', b: 'Hot sauce on nothing' },
  { a: 'Milk first', b: 'Tea first' },
  { a: 'Loud restaurant', b: 'Quiet cafe' },
  { a: 'Sit at the front', b: 'Sit at the back' },
  { a: 'Emoji every message', b: 'No emoji ever' },
  { a: 'Wake up talking', b: 'Wake up silent' },
  { a: 'Fold the laundry', b: 'Live from the basket' },
  { a: 'Ironed', b: 'Creases are character' },
  { a: 'Give the directions', b: 'Follow the directions' },
  { a: 'Straight to the point', b: 'Set the scene first' },
  { a: 'Buy the ticket early', b: 'Buy it last minute' },
  { a: 'Split the bill', b: 'Take turns paying' },
  { a: 'Salt', b: 'Pepper' },
  { a: 'Say hi to the neighbour', b: 'Cross the road' },
  { a: 'Loud sneeze', b: 'Tiny sneeze' },
  { a: 'Aisle at the cinema', b: 'Middle of the row' },
  { a: 'One big pillow', b: 'Three small pillows' },
  { a: 'Subtitles on', b: 'Subtitles off' },
  { a: 'Big spoon', b: 'Little spoon' },
  { a: 'Pet names', b: 'Real names' },
  { a: 'Win the argument', b: 'Keep the peace' },
  { a: 'Plan the date', b: 'Be surprised' },
  { a: 'Post about us', b: 'Keep us offline' },
  { a: 'Matching outfits', b: 'Never matching' },
  { a: 'Double text', b: 'Wait it out' },
  { a: 'Say it first', b: 'Wait to hear it' },
  { a: 'Share the dessert', b: 'Order two' },
  { a: 'Leave the last bite', b: 'Finish the plate' },
  { a: 'Dishes now', b: 'Dishes tomorrow' },
  { a: 'Cook together', b: 'One cooks, one keeps company' },
  { a: 'Ask for directions', b: 'Work it out' },
  { a: 'Watch the trailer', b: 'Go in blind' },
  { a: 'Finish the series tonight', b: 'One episode a week' },
  { a: 'Packed a week early', b: 'Packed at midnight' },
  { a: 'Hotel breakfast', b: 'Find a local place' },
  { a: 'Fridge magnet souvenir', b: 'Photos only' },
  { a: 'Surprise party', b: 'Please, no' },
  { a: 'Birthday fuss', b: 'Birthday quiet' },
  { a: 'Dance at the wedding', b: 'Hold the drinks' },
  { a: 'Nap on the sofa', b: 'Nap properly in bed' },
  { a: 'Kiss goodbye at the door', b: 'Shout from the kitchen' },
  { a: 'Sunday planning', b: 'Sunday nothing' },
  { a: 'Audio guide', b: 'Wander and guess' },
  { a: 'Turn up early', b: 'Turn up late' },
];

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Both of the day's pairs.
 *
 * WHY THIS IS A ROTATION AND NOT A HASH. The old version picked with
 * `hash(date) % pool.length` for round one and a salted hash for round two,
 * which is a draw WITH replacement: over a pool-length run it served roughly
 * two thirds of the pairs and repeated the rest, so couples kept meeting
 * either/ors they had already played. `rotationIndexes` walks a fixed shuffled
 * order instead, so every pair appears exactly once before any appears twice,
 * across days AND across the two rounds of a day. The old "nudge round two if
 * it collided with round one" hack is gone with it: consecutive positions in
 * one sequence cannot collide, so there is nothing left to nudge.
 */
const GAME_ROTATION_SALT = 'ours-this-or-that-v1';

export function gamesForToday(): { game_date: string; rounds: [GamePair, GamePair] } {
  const game_date = todayUTC();
  const [first, second] = rotationIndexes(game_date, GAME_POOL.length, 2, GAME_ROTATION_SALT);
  return { game_date, rounds: [GAME_POOL[first], GAME_POOL[second]] };
}

export function todaysGame(): { game_date: string } & GamePair {
  const { game_date, rounds } = gamesForToday();
  return { game_date, ...rounds[0] };
}

/**
 * How often you two pick the SAME either/or, across every round either of
 * you has ever played. Pure arithmetic over `daily_game_answers`, the table
 * the route already writes to on every play; nothing new is stored for this.
 * `b.user_id > a.user_id` (an ordered pair, not just `!=`) is what keeps each
 * day counted ONCE rather than twice, since "did A match B" and "did B match
 * A" are the same fact (unlike the correct-guess count elsewhere in
 * home.ts, where the two directions are genuinely different events and both
 * should count). Catch-guarded like every other daily_game_answers query
 * (v16/v18 table), so a pre-migration deploy degrades to "no stat" instead
 * of a 500.
 */
async function agreementStatsFor(coupleId: string): Promise<{ agreed: number; total: number } | null> {
  const row = await one<{ agreed: number; total: number }>(
    `SELECT
       (count(*) FILTER (WHERE a.pick = b.pick)
      + count(*) FILTER (WHERE a.pick2 IS NOT NULL AND b.pick2 IS NOT NULL AND a.pick2 = b.pick2))::int AS agreed,
       (count(*)
      + count(*) FILTER (WHERE a.pick2 IS NOT NULL AND b.pick2 IS NOT NULL))::int AS total
     FROM daily_game_answers a
     JOIN daily_game_answers b
       ON b.couple_id = a.couple_id AND b.game_date = a.game_date AND b.user_id > a.user_id
     WHERE a.couple_id = $1`,
    [coupleId]
  ).catch(() => undefined);
  return row ?? null;
}

/**
 * The game state one partner is allowed to see. Before both have played a
 * round, the partner's row is reduced to a boolean; picks and guesses stay
 * server-side (same privacy shape as prompt answers).
 */
export async function gameStateFor(coupleId: string, userId: string) {
  const { game_date, rounds } = gamesForToday();
  const rows = await q<AnswerRow>(
    `SELECT user_id, pick, guess, pick2, guess2, created_at::STRING AS created_at
     FROM daily_game_answers WHERE couple_id = $1 AND game_date = $2`,
    [coupleId, game_date]
  ).catch(() => [] as AnswerRow[]); // pre-v16/v18 deploy: degrade to "not played"

  const mine = rows.find((r) => r.user_id === userId) ?? null;
  const theirs = rows.find((r) => r.user_id !== userId) ?? null;
  const { round, opensAt } = roundStateFor(rows);

  // Read the round in play off the right pair of columns.
  const myPick = round === 1 ? mine?.pick ?? null : mine?.pick2 ?? null;
  const myGuess = round === 1 ? mine?.guess ?? null : mine?.guess2 ?? null;
  const theirPick = round === 1 ? theirs?.pick ?? null : theirs?.pick2 ?? null;
  const theirGuess = round === 1 ? theirs?.guess ?? null : theirs?.guess2 ?? null;
  const both = !!myPick && !!theirPick;
  // Only computed at the reveal moment (an extra query, but just the one
  // moment it is actually shown), never on every idle poll.
  const agreement = both ? await agreementStatsFor(coupleId) : null;

  return {
    game: { game_date, round, ...rounds[round - 1] },
    round,
    /** Set while round one is settled but round two has not opened yet. */
    nextRoundAt: opensAt,
    played: !!myPick,
    partnerPlayed: !!theirPick,
    mine: myPick && myGuess ? { pick: myPick, guess: myGuess } : null,
    reveal: both
      ? {
          partnerPick: theirPick!,
          iGuessedRight: myGuess === theirPick,
          theyGuessedRight: theirGuess === myPick,
          /** How often you two pick the same either/or, all-time. Null pre-migration. */
          agreement,
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

  // POST: play the round that is currently open.
  const pick = String(req.body?.pick ?? '');
  const guess = String(req.body?.guess ?? '');
  if (!LETTERS.has(pick) || !LETTERS.has(guess)) throw new HttpError(400, 'Pick and guess must be a or b');

  const { game_date } = gamesForToday();
  // Which round is open is the server's call, never the client's.
  const before = await gameStateFor(cid, user.id);

  if (before.round === 1) {
    const inserted = await one(
      `INSERT INTO daily_game_answers (couple_id, user_id, game_date, pick, guess)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (couple_id, user_id, game_date) DO NOTHING
       RETURNING id`,
      [cid, user.id, game_date, pick, guess]
    );
    if (!inserted) {
      throw new HttpError(
        409,
        before.nextRoundAt
          ? 'You have played this one. The next question opens a little later today.'
          : 'You already played this one. One more comes later today.'
      );
    }
  } else {
    // Round two lands on the same row, and only if it is still empty (the
    // WHERE clause is what makes a replay a no-op rather than an overwrite).
    const updated = await one(
      `UPDATE daily_game_answers
       SET pick2 = $4, guess2 = $5, round2_at = now()
       WHERE couple_id = $1 AND user_id = $2 AND game_date = $3 AND pick2 IS NULL
       RETURNING id`,
      [cid, user.id, game_date, pick, guess]
    );
    if (!updated) throw new HttpError(409, 'You already played both of today’s questions. Tomorrow brings more.');
  }

  const state = await gameStateFor(cid, user.id);
  // Tell the partner something changed. No picks in the event: the first
  // answerer's choice must stay hidden until the reveal, and after the reveal
  // clients refetch their own view anyway.
  await publish(cid, 'game.updated', {
    game_date,
    round: before.round,
    by: user.id,
    revealed: !!state.reveal,
  });
  if (state.reveal) {
    // The FIRST answerer gets pulled back for the payoff. Generic on purpose.
    await notify(cid, user.id, 'game', `${user.display_name} played today's This or That. See how you both chose`);
  }
  res.status(201).json(state);
});
