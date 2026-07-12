import { getPool, one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, requireString, HttpError } from '../_lib/respond';
import { PROPOSAL_COLUMNS } from './dates';

/**
 * PATCH /api/dates/:id with { action: 'accept' | 'decline' | 'counter', ... }.
 * Only the partner who did NOT propose can act. Accepting a dated proposal
 * creates a custom milestone in the same transaction. Countering creates a
 * fresh proposal (proposer swapped) and marks the original countered.
 */
export default route(['PATCH'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');
  const action = req.body?.action;
  if (!['accept', 'decline', 'counter'].includes(action)) {
    throw new HttpError(400, 'action must be accept, decline, or counter');
  }

  const proposal = await one<{
    id: string;
    proposer_id: string;
    title: string;
    location: string | null;
    proposed_for: string | null;
    status: string;
  }>(
    `SELECT id, proposer_id, title, location, proposed_for::STRING AS proposed_for, status
     FROM date_proposals WHERE id = $1 AND couple_id = $2`,
    [id, user.couple_id]
  );
  if (!proposal) throw new HttpError(404, 'Proposal not found');
  if (proposal.status !== 'open') throw new HttpError(409, 'This proposal was already resolved');
  if (proposal.proposer_id === user.id) throw new HttpError(403, 'You proposed this one, your partner decides');

  if (action === 'counter') {
    const title = requireString(req.body?.title, 'Title', 140);
    const location = req.body?.location ? requireString(req.body.location, 'Location', 200) : null;
    let proposedFor: string | null = null;
    if (req.body?.proposedFor) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.proposedFor)) throw new HttpError(400, 'proposedFor must be YYYY-MM-DD');
      proposedFor = req.body.proposedFor;
    }
    const client = await getPool().connect();
    let counter;
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE date_proposals SET status = 'countered', updated_at = now() WHERE id = $1`, [id]);
      const { rows } = await client.query(
        `INSERT INTO date_proposals (couple_id, proposer_id, title, location, proposed_for, counter_of)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${PROPOSAL_COLUMNS}`,
        [user.couple_id, user.id, title, location, proposedFor, id]
      );
      counter = rows[0];
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await publish(user.couple_id, 'date.updated', { id, counter_id: counter.id });
    await notify(user.couple_id, user.id, 'date', `${user.display_name} countered with: ${counter.title}`);
    res.status(200).json({ proposal: counter });
    return;
  }

  const nextStatus = action === 'accept' ? 'accepted' : 'declined';
  let milestoneId: string | null = null;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    if (action === 'accept' && proposal.proposed_for) {
      const { rows } = await client.query(
        `INSERT INTO milestones (couple_id, author_id, title, date, kind)
         VALUES ($1, $2, $3, $4, 'custom') RETURNING id`,
        [user.couple_id, user.id, `Date: ${proposal.title}`, proposal.proposed_for]
      );
      milestoneId = rows[0].id;
    }
    await client.query(
      `UPDATE date_proposals SET status = $2, milestone_id = $3, updated_at = now() WHERE id = $1`,
      [id, nextStatus, milestoneId]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const updated = await one(`SELECT ${PROPOSAL_COLUMNS} FROM date_proposals WHERE id = $1`, [id]);
  await publish(user.couple_id, 'date.updated', { id, status: nextStatus });
  await notify(
    user.couple_id,
    user.id,
    'date',
    action === 'accept'
      ? `${user.display_name} said yes to: ${proposal.title}`
      : `${user.display_name} passed on: ${proposal.title}`
  );
  res.status(200).json({ proposal: updated });
});
