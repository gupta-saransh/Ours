import { getPool, one } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';
import { PROPOSAL_COLUMNS, PROPOSAL_META_COLUMNS, decodeProposal, parseTime } from './dates';

/**
 * PATCH /api/dates/:id with { action }, and DELETE /api/dates/:id.
 *  - accept | decline | counter: only the partner who did NOT propose can act.
 *    Accepting a dated proposal creates a custom milestone in the same
 *    transaction; countering creates a fresh proposal (proposer swapped).
 *  - complete: either partner logs how an accepted date went
 *    { rating?, reflection?, memoryId?, saveIdea? }. Optionally links a
 *    timeline memory the client already created, and saves the date to the
 *    couple's rotating idea pool. Deliberately NOT limited to dates whose day
 *    has passed: a date can happen early, or have no date at all.
 *  - edit: change { title, location, proposedFor, proposedTime }. An OPEN
 *    proposal is the proposer's to edit (their partner is mid-decision on it);
 *    an ACCEPTED date belongs to both, so either may edit it. Changing the day
 *    or time resets the reminder flags so the new schedule fires, and keeps the
 *    milestone the acceptance created in step.
 *  - DELETE: same ownership rule as edit, and takes the linked milestone with
 *    it. A shared plan either partner agreed to is one either partner may call
 *    off, the same exception memories already make.
 */

/** Who is allowed to change or remove this proposal? */
function canModify(proposal: { proposer_id: string; status: string }, userId: string): boolean {
  if (proposal.status === 'accepted') return true; // shared plan, either partner
  return proposal.proposer_id === userId; // still just an idea, and it is theirs
}

export default route(['PATCH', 'DELETE'], async (req, res) => {
  const user = await requirePairedUser(req);
  const id = String(req.query.id ?? '');
  const action = req.method === 'DELETE' ? 'delete' : req.body?.action;
  if (!['accept', 'decline', 'counter', 'complete', 'edit', 'delete'].includes(action)) {
    throw new HttpError(400, 'action must be accept, decline, counter, complete, or edit');
  }

  const proposal = await one<{
    id: string;
    proposer_id: string;
    title: string;
    title_ct: Buffer | null;
    location: string | null;
    location_ct: Buffer | null;
    proposed_for: string | null;
    status: string;
    milestone_id: string | null;
    completed_at: string | null;
  }>(
    `SELECT id, proposer_id, title, title_ct, location, location_ct, proposed_for::STRING AS proposed_for,
            status, milestone_id, completed_at::STRING AS completed_at
     FROM date_proposals WHERE id = $1 AND couple_id = $2`,
    [id, user.couple_id]
  );
  if (!proposal) throw new HttpError(404, 'Proposal not found');

  // Plaintext title for the milestone/idea we may create (envelope.ts).
  const proposalTitle = (await readField(user.couple_id, proposal.title_ct, proposal.title)) ?? '';

  // ---- Call it off ----
  if (action === 'delete') {
    if (!canModify(proposal, user.id)) {
      throw new HttpError(403, 'Only the partner who proposed this can remove it');
    }
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      // The milestone only exists because this date was accepted, so it goes too.
      if (proposal.milestone_id) {
        await client.query('DELETE FROM milestones WHERE id = $1 AND couple_id = $2', [
          proposal.milestone_id,
          user.couple_id,
        ]);
      }
      await client.query('DELETE FROM date_proposals WHERE id = $1 AND couple_id = $2', [id, user.couple_id]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    await publish(user.couple_id, 'date.updated', { id, deleted: true });
    // Generic: the title is encrypted and must not reach the notifications table.
    if (proposal.status === 'accepted') {
      await notify(user.couple_id, user.id, 'date', `${user.display_name} called off a date`);
    }
    res.status(200).json({ ok: true });
    return;
  }

  // ---- Change the plan ----
  if (action === 'edit') {
    if (!canModify(proposal, user.id)) {
      throw new HttpError(403, 'Only the partner who proposed this can change it');
    }
    if (proposal.completed_at) throw new HttpError(409, 'This date is already logged');

    const title = requireString(req.body?.title, 'Title', 140);
    const location = req.body?.location ? requireString(req.body.location, 'Location', 200) : null;
    let proposedFor: string | null = null;
    if (req.body?.proposedFor) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.proposedFor)) throw new HttpError(400, 'proposedFor must be YYYY-MM-DD');
      proposedFor = req.body.proposedFor;
    }
    const proposedTime = parseTime(req.body?.proposedTime);
    const titleCt = await encryptField(user.couple_id, title);
    const locationCt = location ? await encryptField(user.couple_id, location) : null;

    // A moved date needs its reminders again: the 24h/6h/1h flags describe the
    // OLD time, so leaving them set would silence the new one.
    const moved = proposedFor !== proposal.proposed_for;

    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE date_proposals
         SET title = $2, title_ct = $3, location = $4, location_ct = $5,
             proposed_for = $6, proposed_time = $7, updated_at = now(),
             reminded_24 = CASE WHEN $8 THEN false ELSE reminded_24 END,
             reminded_6  = CASE WHEN $8 THEN false ELSE reminded_6  END,
             reminded_1  = CASE WHEN $8 THEN false ELSE reminded_1  END
         WHERE id = $1`,
        [id, titleCt ? '' : title, titleCt, locationCt ? null : location, locationCt, proposedFor, proposedTime, moved]
      );

      // Keep the milestone the acceptance created in step with the plan.
      if (proposal.milestone_id && proposedFor) {
        await client.query('UPDATE milestones SET title = $2, date = $3 WHERE id = $1 AND couple_id = $4', [
          proposal.milestone_id,
          `Date: ${title}`,
          proposedFor,
          user.couple_id,
        ]);
      } else if (proposal.milestone_id && !proposedFor) {
        // The day was cleared, so there is nothing to count down to.
        await client.query('DELETE FROM milestones WHERE id = $1 AND couple_id = $2', [
          proposal.milestone_id,
          user.couple_id,
        ]);
        await client.query('UPDATE date_proposals SET milestone_id = NULL WHERE id = $1', [id]);
      } else if (!proposal.milestone_id && proposedFor && proposal.status === 'accepted') {
        // A day was added to an already-accepted date: it earns its milestone.
        const { rows } = await client.query(
          `INSERT INTO milestones (couple_id, author_id, title, date, kind)
           VALUES ($1, $2, $3, $4, 'custom') RETURNING id`,
          [user.couple_id, user.id, `Date: ${title}`, proposedFor]
        );
        await client.query('UPDATE date_proposals SET milestone_id = $2 WHERE id = $1', [id, rows[0].id]);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    const editedRow = await one<Record<string, any>>(`SELECT ${PROPOSAL_COLUMNS} FROM date_proposals WHERE id = $1`, [id]);
    const edited = editedRow ? await decodeProposal(user.couple_id, editedRow) : null;
    await publish(user.couple_id, 'date.updated', { id, edited: true });
    await notify(user.couple_id, user.id, 'date', `${user.display_name} changed a date`);
    res.status(200).json({ proposal: edited });
    return;
  }

  // ---- Post-date reflection ----
  if (action === 'complete') {
    if (proposal.status !== 'accepted') throw new HttpError(409, 'Only an accepted date can be logged');
    const rating = req.body?.rating;
    if (rating !== undefined && rating !== null && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
      throw new HttpError(400, 'rating must be 1 to 5');
    }
    const reflection = req.body?.reflection ? requireString(req.body.reflection, 'Note', 2000) : null;
    const memoryId = typeof req.body?.memoryId === 'string' ? req.body.memoryId : null;
    if (memoryId) {
      const mem = await one<{ id: string }>('SELECT id FROM memories WHERE id = $1 AND couple_id = $2', [
        memoryId,
        user.couple_id,
      ]);
      if (!mem) throw new HttpError(400, 'That memory is not in your space');
    }
    const reflectionCt = reflection ? await encryptField(user.couple_id, reflection) : null;

    await one(
      `UPDATE date_proposals
       SET rating = $2, reflection = $3, reflection_ct = $4, memory_id = COALESCE($5, memory_id),
           completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [id, rating ?? null, reflectionCt ? '' : reflection, reflectionCt, memoryId]
    );

    if (req.body?.saveIdea === true) {
      const location = (await readField(user.couple_id, proposal.location_ct, proposal.location)) ?? null;
      const titleCt = await encryptField(user.couple_id, proposalTitle);
      const locationCt = location ? await encryptField(user.couple_id, location) : null;
      await one(
        `INSERT INTO date_ideas (couple_id, title, title_ct, location, location_ct, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [user.couple_id, titleCt ? '' : proposalTitle, titleCt, locationCt ? null : location, locationCt, user.id]
      );
    }

    const updatedRow = await one<Record<string, any>>(`SELECT ${PROPOSAL_COLUMNS} FROM date_proposals WHERE id = $1`, [id]);
    const updated = updatedRow ? await decodeProposal(user.couple_id, updatedRow) : null;
    await publish(user.couple_id, 'date.updated', { id, completed: true });
    await notify(user.couple_id, user.id, 'date', `${user.display_name} shared how your date went`);
    res.status(200).json({ proposal: updated });
    return;
  }

  // ---- Accept / decline / counter (only the non-proposer) ----
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
    const proposedTime = parseTime(req.body?.proposedTime);
    const titleCt = await encryptField(user.couple_id, title);
    const locationCt = location ? await encryptField(user.couple_id, location) : null;
    const client = await getPool().connect();
    let counterMeta;
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE date_proposals SET status = 'countered', updated_at = now() WHERE id = $1`, [id]);
      const { rows } = await client.query(
        `INSERT INTO date_proposals (couple_id, proposer_id, title, title_ct, location, location_ct, proposed_for, proposed_time, counter_of)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING ${PROPOSAL_META_COLUMNS}`,
        [user.couple_id, user.id, titleCt ? '' : title, titleCt, locationCt ? null : location, locationCt, proposedFor, proposedTime, id]
      );
      counterMeta = rows[0];
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    const counter = { ...counterMeta, title, location };
    await publish(user.couple_id, 'date.updated', { id, counter_id: counter.id });
    await notify(user.couple_id, user.id, 'date', `${user.display_name} countered with another idea`);
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
        [user.couple_id, user.id, `Date: ${proposalTitle}`, proposal.proposed_for]
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

  const updatedRow = await one<Record<string, any>>(`SELECT ${PROPOSAL_COLUMNS} FROM date_proposals WHERE id = $1`, [id]);
  const updated = updatedRow ? await decodeProposal(user.couple_id, updatedRow) : null;
  await publish(user.couple_id, 'date.updated', { id, status: nextStatus });
  await notify(
    user.couple_id,
    user.id,
    'date',
    action === 'accept' ? `${user.display_name} said yes to your date` : `${user.display_name} passed on a date`
  );
  res.status(200).json({ proposal: updated });
});
