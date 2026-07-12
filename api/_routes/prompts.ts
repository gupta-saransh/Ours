import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * Daily prompt with mutual reveal. One question per day; answers stay private
 * until both partners have submitted, then both surface, forever, in history.
 * The pool is static by design (no AI, no network): deterministic selection
 * by date keeps every couple on the same question each day.
 */
export const PROMPT_POOL: string[] = [
  'What made you smile about them this week?',
  'What is a tiny habit of theirs you secretly love?',
  'Where would you take them tomorrow if money did not matter?',
  'What did you think the first time you saw them?',
  'What song reminds you of them right now?',
  'What is something they taught you without meaning to?',
  'What meal would you cook for them tonight?',
  'When did you last feel proud of them?',
  'What do you want to be doing together in five years?',
  'What is your favorite photo of the two of you, and why?',
  'What is one thing you have never told them you appreciate?',
  'Which of their laughs is your favorite?',
  'What smells like them?',
  'What would a perfect lazy Sunday together look like?',
  'What were you most nervous about early on?',
  'What is the best gift they ever gave you, big or small?',
  'What do they do better than anyone you know?',
  'Which trip together do you replay in your head?',
  'What is something new you want to try together this month?',
  'When do they look most at home?',
  'What did they say that you still think about?',
  'What would you title the movie of your relationship?',
  'What is your favorite ordinary moment with them?',
  'What do you hope never changes about them?',
  'What is one fear they helped shrink?',
  'What food will always be "yours" together?',
  'What is the kindest thing they did for a stranger?',
  'Which of their opinions changed your mind?',
  'What is your favorite thing to watch them do?',
  'When did you last laugh together until it hurt?',
  'What is a promise you want to make them today?',
  'What would you tell them on their worst day?',
  'What is a place you want to show them someday?',
  'What did you learn about love from them?',
  'What is the first thing you notice when they walk in?',
  'What small thing do they do that feels like home?',
  'What would you two do with a whole free day tomorrow?',
  'Which memory of them do you want to keep forever?',
  'What are you looking forward to together this year?',
  'What do you want to thank them for right now?',
  'What is their most underrated quality?',
  'What was your favorite date so far?',
  'What is a skill of theirs that still surprises you?',
  'What nickname of theirs is your favorite, and why?',
  'When did you know this was serious?',
  'What is a hard thing you got through together?',
  'What is your favorite way they say your name?',
  'What tradition do you want to start together?',
  'What is the best advice they ever gave you?',
  'What do you love about the way they see the world?',
  'What would you write on a note left in their pocket?',
  'What is a dream of theirs you want to help happen?',
  'What is your favorite season with them, and why?',
  'What is something silly you only do together?',
  'What do they do when they think nobody is watching?',
  'What is a moment you wish you had photographed?',
  'What would surprise your past self about the two of you?',
  'What is their superpower?',
  'What is your favorite conversation you two ever had?',
  'When do you feel closest to them?',
  'What is one thing you want to do better for them?',
  'What is a smell, sound, or taste that means "us"?',
  'What is the most spontaneous thing you did together?',
  'What are they better at than they believe?',
  'What is your favorite picture they have taken of you?',
  'What would your first date look like if you redid it today?',
  'What is a book, show, or film that feels like your story?',
  'What did their family or friends tell you about them that proved true?',
  'What is one thing about them you never want to take for granted?',
  'What made you feel taken care of recently?',
  'What is the funniest misunderstanding you two ever had?',
  'Which city feels like it belongs to you two?',
  'What do you want more of, together, this month?',
  'What did you almost not do that led you to them?',
  'What is your favorite thing they wear?',
  'What is a compliment you have been meaning to give?',
  'When were you most impressed by them?',
  'What tiny detail about them would you describe to a stranger?',
  'What is your favorite way to be greeted by them?',
  'What is something you want to ask them but have not?',
  'What would you put in a time capsule about this week?',
  'What is the most "them" thing they did lately?',
  'Which habit of yours do you think they secretly loves?',
  'What is a moment you felt truly seen by them?',
  'What is one adventure still on your list together?',
  'What do you admire about how they handle hard days?',
  'What made you choose them, again, this week?',
  'What is your favorite sound in your shared life?',
  'What is a joke only the two of you understand?',
  'What would you cook together on a rainy evening?',
  'What part of your routine together is sacred?',
  'What did you learn about yourself because of them?',
  'What is the gentlest thing they have ever said to you?',
  'What is your favorite photo you have not taken yet?',
  'When did they make an ordinary day feel special?',
  'What do you hope they know without you saying it?',
  'What are you grateful for about this exact chapter of you two?',
  'What is the next little thing you want to celebrate together?',
];

function poolIndexFor(dateStr: string): number {
  let h = 0;
  for (let i = 0; i < dateStr.length; i++) h = (h * 31 + dateStr.charCodeAt(i)) >>> 0;
  return h % PROMPT_POOL.length;
}

export async function todaysPrompt(): Promise<{ prompt_date: string; text: string }> {
  const today = new Date().toISOString().slice(0, 10);
  const text = PROMPT_POOL[poolIndexFor(today)];
  // Upsert so history stays stable even if the pool is reordered later.
  await one(
    `INSERT INTO daily_prompts (prompt_date, text) VALUES ($1, $2) ON CONFLICT (prompt_date) DO NOTHING`,
    [today, text]
  );
  const row = await one<{ prompt_date: string; text: string }>(
    `SELECT prompt_date::STRING AS prompt_date, text FROM daily_prompts WHERE prompt_date = $1`,
    [today]
  );
  return row!;
}

interface Answer {
  user_id: string;
  text: string;
  created_at: string;
}

export async function promptStateFor(coupleId: string, userId: string) {
  const prompt = await todaysPrompt();
  const answers = await q<Answer>(
    `SELECT user_id, text, created_at FROM daily_prompt_answers
     WHERE couple_id = $1 AND prompt_date = $2`,
    [coupleId, prompt.prompt_date]
  );
  const mine = answers.find((a) => a.user_id === userId) ?? null;
  const theirs = answers.find((a) => a.user_id !== userId) ?? null;
  const bothAnswered = !!mine && !!theirs;
  return {
    prompt,
    myAnswer: mine ? mine.text : null,
    partnerAnswer: bothAnswered ? theirs!.text : null,
    partnerAnswered: !!theirs,
    bothAnswered,
  };
}

/** GET/POST /api/prompt/today · GET /api/prompt/history?before=&limit= */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const isHistory = (req.url ?? '').split('?')[0].endsWith('/history');

  if (isHistory) {
    const before = typeof req.query.before === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.before)
      ? req.query.before
      : '9999-12-31';
    const rows = await q(
      `SELECT a.prompt_date::STRING AS prompt_date, p.text AS prompt, a.user_id, a.text
       FROM daily_prompt_answers a
       JOIN daily_prompts p ON p.prompt_date = a.prompt_date
       WHERE a.couple_id = $1 AND a.prompt_date < $2
         AND (SELECT count(*) FROM daily_prompt_answers b
              WHERE b.couple_id = a.couple_id AND b.prompt_date = a.prompt_date) = 2
       ORDER BY a.prompt_date DESC, a.created_at ASC
       LIMIT 40`,
      [user.couple_id, before]
    );
    // Group the row pairs into one entry per date.
    const byDate = new Map<string, { prompt_date: string; prompt: string; answers: { user_id: string; text: string }[] }>();
    for (const r of rows as any[]) {
      const entry =
        byDate.get(r.prompt_date) ??
        ({ prompt_date: r.prompt_date, prompt: r.prompt, answers: [] } as {
          prompt_date: string;
          prompt: string;
          answers: { user_id: string; text: string }[];
        });
      entry.answers.push({ user_id: r.user_id, text: r.text });
      byDate.set(r.prompt_date, entry);
    }
    res.status(200).json({ entries: [...byDate.values()] });
    return;
  }

  if (req.method === 'GET') {
    res.status(200).json(await promptStateFor(user.couple_id, user.id));
    return;
  }

  // POST: submit today's answer. One submission per person per day.
  const answerText = requireString(req.body?.text, 'Answer', 2000);
  const prompt = await todaysPrompt();
  const existing = await one(
    `SELECT id FROM daily_prompt_answers WHERE couple_id = $1 AND user_id = $2 AND prompt_date = $3`,
    [user.couple_id, user.id, prompt.prompt_date]
  );
  if (existing) throw new HttpError(409, 'You already answered today');

  await one(
    `INSERT INTO daily_prompt_answers (couple_id, user_id, prompt_date, text) VALUES ($1, $2, $3, $4)`,
    [user.couple_id, user.id, prompt.prompt_date, answerText]
  );

  const count = await one<{ n: number }>(
    `SELECT count(*)::int AS n FROM daily_prompt_answers WHERE couple_id = $1 AND prompt_date = $2`,
    [user.couple_id, prompt.prompt_date]
  );
  if ((count?.n ?? 0) >= 2) {
    await publish(user.couple_id, 'prompt.revealed', { prompt_date: prompt.prompt_date });
    await notify(user.couple_id, user.id, 'prompt', 'You both answered today’s prompt');
  } else {
    await publish(user.couple_id, 'prompt.answered', { prompt_date: prompt.prompt_date, by: user.id });
    await notify(user.couple_id, user.id, 'prompt', 'A new answer is waiting for yours');
  }

  res.status(201).json(await promptStateFor(user.couple_id, user.id));
});
