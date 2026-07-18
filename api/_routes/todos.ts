import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

/**
 * The shared to-do list. ONE list per couple, both partners see all of it, so
 * the two of you can hold each other accountable: either adds, either ticks,
 * and finishing something tells the other person.
 *
 *   GET  /api/todos?date=YYYY-MM-DD   that day's items + the month's day counts
 *   POST /api/todos                   { title, dueDate?, assigneeId? }
 *
 * Every to-do belongs to a DAY (the screen shows one day at a time). An
 * unfinished item STAYS on its day rather than rolling forward on its own:
 * moving it is a decision the couple makes, and the count of what is still open
 * behind you is surfaced instead of quietly rewritten.
 *
 * `assignee_id` NULL means "both of us", which is the default so adding
 * something costs one field. Titles are encrypted at rest, so every
 * notification below stays generic.
 */

const COLUMNS =
  'id, author_id, assignee_id, title, title_ct, due_date::STRING AS due_date, done, done_by, done_at, created_at';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Validate a YYYY-MM-DD the client sent, or fall back to today. */
export function readDate(raw: unknown, fallback = todayUTC()): string {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw !== 'string' || !DATE_RE.test(raw)) throw new HttpError(400, 'Date must look like YYYY-MM-DD');
  // Reject the impossible (2026-02-31) rather than let the DB coerce it.
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new HttpError(400, 'That is not a real date');
  }
  return raw;
}

/** First and last day of the month a date falls in, as YYYY-MM-DD. */
export function monthBounds(date: string): { from: string; to: string } {
  const [y, m] = date.split('-').map(Number);
  const from = `${date.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from, to: `${date.slice(0, 7)}-${String(lastDay).padStart(2, '0')}` };
}

// Explicit return type: TS drops the index signature when a Record<string, any>
// is rest-destructured (a known inference quirk), which would otherwise narrow
// this to just `{ title: string }` and break every field access at call sites.
export async function decodeTodo(coupleId: string, row: Record<string, any>): Promise<Record<string, any>> {
  const { title_ct, ...rest } = row;
  return { ...rest, title: (await readField(coupleId, title_ct, rest.title)) ?? '' };
}

/** Whose it is: null (both) or a member of this couple. Anything else is a 400. */
async function readAssignee(coupleId: string, raw: unknown): Promise<string | null> {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new HttpError(400, 'Unknown person');
  const member = await one<{ id: string }>('SELECT id FROM users WHERE id = $1 AND couple_id = $2', [
    raw,
    coupleId,
  ]);
  if (!member) throw new HttpError(400, 'That person is not in your space');
  return member.id;
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;

  if (req.method === 'GET') {
    const date = readDate(Array.isArray(req.query.date) ? req.query.date[0] : req.query.date);
    const { from, to } = monthBounds(date);
    const today = todayUTC();

    const [rows, days, behind] = await Promise.all([
      q<Record<string, any>>(
        `SELECT ${COLUMNS} FROM todos WHERE couple_id = $1 AND due_date = $2
         ORDER BY done ASC, created_at ASC LIMIT 200`,
        [cid, date]
      ),
      // Dots for the calendar jump: how much sits on each day of the month.
      q<{ due_date: string; total: string; done: string }>(
        `SELECT due_date::STRING AS due_date, count(*) AS total, count(*) FILTER (WHERE done) AS done
         FROM todos WHERE couple_id = $1 AND due_date BETWEEN $2 AND $3
         GROUP BY due_date ORDER BY due_date`,
        [cid, from, to]
      ),
      // What is still open on days that have already passed. Surfaced, never
      // silently moved. earliest_due doubles as "where to send you to catch up".
      one<{ n: string; earliest_due: string | null }>(
        `SELECT count(*) AS n, min(due_date)::STRING AS earliest_due
         FROM todos WHERE couple_id = $1 AND done = false AND due_date < $2`,
        [cid, today]
      ),
    ]);

    res.status(200).json({
      date,
      items: await Promise.all(rows.map((r) => decodeTodo(cid, r))),
      days: days.map((d) => ({ date: d.due_date, total: Number(d.total), done: Number(d.done) })),
      overdue: Number(behind?.n ?? 0),
      earliestOverdue: behind?.earliest_due ?? null,
    });
    return;
  }

  const title = requireString(req.body?.title, 'To-do', 300);
  const dueDate = readDate(req.body?.dueDate);
  const assigneeId = await readAssignee(cid, req.body?.assigneeId);

  const titleCt = await encryptField(cid, title);
  const created = await one<Record<string, any>>(
    `INSERT INTO todos (couple_id, author_id, assignee_id, title, title_ct, due_date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, author_id, assignee_id, due_date::STRING AS due_date, done, done_by, done_at, created_at`,
    [cid, user.id, assigneeId, titleCt ? '' : title, titleCt, dueDate]
  );
  const item: Record<string, any> = { ...created, title };

  await publish(cid, 'todo.updated', { id: item.id, due_date: dueDate, by: user.id });
  // Generic on purpose: the title is encrypted and must never land in the
  // plaintext notifications table.
  await notify(
    cid,
    user.id,
    'todo',
    assigneeId && assigneeId !== user.id
      ? `${user.display_name} added something to your list`
      : `${user.display_name} added something to your shared list`
  );
  res.status(201).json({ item });
});
