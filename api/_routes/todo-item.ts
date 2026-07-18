import { one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';
import { decodeTodo, readDate } from './todos';

/**
 * One to-do.
 *
 *   PATCH /api/todos/:id   { done? , title?, dueDate?, assigneeId? }
 *   DELETE /api/todos/:id
 *
 * PERMISSIONS. The list is shared, but "using" it and "owning" an item are
 * different things:
 *   - EITHER partner may tick something off or move it to another day. That is
 *     the entire point of a shared list, and completing your partner's task is
 *     a kindness, not an intrusion.
 *   - ONLY the author may rename or delete. This keeps the app's own-content
 *     delete invariant intact (the documented exceptions stay memories and
 *     accepted date proposals, nothing new is added here).
 * couple_id is filtered in every case regardless.
 */

const COLUMNS =
  'id, author_id, assignee_id, title, title_ct, due_date::STRING AS due_date, done, done_by, done_at, created_at';

interface TodoRow {
  id: string;
  author_id: string;
  assignee_id: string | null;
  due_date: string;
  done: boolean;
}

export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const cid = user.couple_id;
  const id = String(req.query.id ?? '');
  if (!id) throw new HttpError(400, 'Missing id');

  const existing = await one<TodoRow>(
    'SELECT id, author_id, assignee_id, due_date::STRING AS due_date, done FROM todos WHERE id = $1 AND couple_id = $2',
    [id, cid]
  );
  if (!existing) throw new HttpError(404, 'That to-do is gone');

  if (req.method === 'DELETE') {
    if (existing.author_id !== user.id) throw new HttpError(403, 'Only whoever added this can remove it');
    await one('DELETE FROM todos WHERE id = $1 AND couple_id = $2 RETURNING id', [id, cid]);
    await publish(cid, 'todo.updated', { id, due_date: existing.due_date, by: user.id, deleted: true });
    res.status(200).json({ ok: true });
    return;
  }

  const sets: string[] = [];
  const args: unknown[] = [id, cid];
  const add = (fragment: string, value: unknown) => {
    args.push(value);
    sets.push(`${fragment} = $${args.length}`);
  };

  let ticked = false;
  if (req.body?.done !== undefined) {
    const done = req.body.done === true;
    ticked = done && !existing.done;
    add('done', done);
    add('done_by', done ? user.id : null);
    sets.push(done ? 'done_at = now()' : 'done_at = NULL');
  }

  if (req.body?.title !== undefined) {
    if (existing.author_id !== user.id) throw new HttpError(403, 'Only whoever added this can reword it');
    const title = requireString(req.body.title, 'To-do', 300);
    const titleCt = await encryptField(cid, title);
    add('title', titleCt ? '' : title);
    add('title_ct', titleCt);
  }

  // Moving a day is how an unfinished item rolls forward: an explicit choice,
  // available to either partner.
  if (req.body?.dueDate !== undefined) add('due_date', readDate(req.body.dueDate));

  if (req.body?.assigneeId !== undefined) {
    const raw = req.body.assigneeId;
    if (raw === null || raw === '') {
      add('assignee_id', null);
    } else {
      const member = await one<{ id: string }>('SELECT id FROM users WHERE id = $1 AND couple_id = $2', [
        String(raw),
        cid,
      ]);
      if (!member) throw new HttpError(400, 'That person is not in your space');
      add('assignee_id', member.id);
    }
  }

  if (sets.length === 0) throw new HttpError(400, 'Nothing to change');

  const updated = await one<Record<string, any>>(
    `UPDATE todos SET ${sets.join(', ')} WHERE id = $1 AND couple_id = $2 RETURNING ${COLUMNS}`,
    args
  );
  if (!updated) throw new HttpError(404, 'That to-do is gone');
  const item = await decodeTodo(cid, updated);

  // previous_due_date lets a partner who is looking at TODAY's list notice an
  // item that just moved away, even though the event's own due_date is the new
  // day. Omitted when the day did not change, so a plain tick or reassign stays
  // a one-field event.
  await publish(cid, 'todo.updated', {
    id,
    due_date: item.due_date,
    previous_due_date: item.due_date !== existing.due_date ? existing.due_date : undefined,
    by: user.id,
  });
  if (ticked) {
    // The accountability moment, and the only one worth a notification.
    // Generic: the title is encrypted at rest.
    await notify(cid, user.id, 'todo', `${user.display_name} ticked something off your list`);
  }
  res.status(200).json({ item });
});
