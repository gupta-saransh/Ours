import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { route, requireString, HttpError } from '../_lib/respond';

export const PROPOSAL_COLUMNS = `id, proposer_id, title, location,
  proposed_for::STRING AS proposed_for, status, counter_of, milestone_id, created_at, updated_at`;

/**
 * GET  /api/dates  open proposals + the last 60 days of resolved ones
 * POST /api/dates  propose a date { title, location?, proposedFor? }
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const proposals = await q(
      `SELECT ${PROPOSAL_COLUMNS} FROM date_proposals
       WHERE couple_id = $1 AND (status = 'open' OR updated_at > now() - INTERVAL '60 days')
       ORDER BY (status = 'open') DESC, updated_at DESC LIMIT 100`,
      [user.couple_id]
    );
    res.status(200).json({ proposals });
    return;
  }

  const title = requireString(req.body?.title, 'Title', 140);
  const location = req.body?.location ? requireString(req.body.location, 'Location', 200) : null;
  let proposedFor: string | null = null;
  if (req.body?.proposedFor) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(req.body.proposedFor)) throw new HttpError(400, 'proposedFor must be YYYY-MM-DD');
    proposedFor = req.body.proposedFor;
  }

  const proposal = await one(
    `INSERT INTO date_proposals (couple_id, proposer_id, title, location, proposed_for)
     VALUES ($1, $2, $3, $4, $5) RETURNING ${PROPOSAL_COLUMNS}`,
    [user.couple_id, user.id, title, location, proposedFor]
  );
  await publish(user.couple_id, 'date.proposed', { id: proposal.id, by: user.id });
  await notify(user.couple_id, user.id, 'date', `${user.display_name} proposed a date: ${title}`);
  res.status(201).json({ proposal });
});
