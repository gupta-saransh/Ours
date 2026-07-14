import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

// title/location are encrypted at rest (envelope.ts): each has a _ct column,
// resolved to plaintext in JS after the query.
export const PROPOSAL_COLUMNS = `id, proposer_id, title, title_ct, location, location_ct,
  proposed_for::STRING AS proposed_for, status, counter_of, milestone_id, created_at, updated_at`;

// Non-text columns, for RETURNING when we already hold the plaintext.
export const PROPOSAL_META_COLUMNS = `id, proposer_id, proposed_for::STRING AS proposed_for,
  status, counter_of, milestone_id, created_at, updated_at`;

/** Decrypt title/location and drop the raw ciphertext columns. */
export async function decodeProposal(coupleId: string, row: Record<string, any>) {
  const { title_ct, location_ct, ...rest } = row;
  return {
    ...rest,
    title: (await readField(coupleId, title_ct, rest.title)) ?? '',
    location: (await readField(coupleId, location_ct, rest.location)) ?? rest.location ?? null,
  };
}

/**
 * GET  /api/dates  open proposals + the last 60 days of resolved ones
 * POST /api/dates  propose a date { title, location?, proposedFor? }
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const rows = await q<Record<string, any>>(
      `SELECT ${PROPOSAL_COLUMNS} FROM date_proposals
       WHERE couple_id = $1 AND (status = 'open' OR updated_at > now() - INTERVAL '60 days')
       ORDER BY (status = 'open') DESC, updated_at DESC LIMIT 100`,
      [user.couple_id]
    );
    const proposals = await Promise.all(rows.map((r) => decodeProposal(user.couple_id, r)));
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

  const titleCt = await encryptField(user.couple_id, title);
  const locationCt = location ? await encryptField(user.couple_id, location) : null;
  const created = await one(
    `INSERT INTO date_proposals (couple_id, proposer_id, title, title_ct, location, location_ct, proposed_for)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${PROPOSAL_META_COLUMNS}`,
    [user.couple_id, user.id, titleCt ? '' : title, titleCt, locationCt ? null : location, locationCt, proposedFor]
  );
  const proposal = { ...created, title, location };
  await publish(user.couple_id, 'date.proposed', { id: proposal.id, by: user.id });
  // Keep the encrypted title out of the plaintext notifications table.
  await notify(user.couple_id, user.id, 'date', `${user.display_name} proposed a date`);
  res.status(201).json({ proposal });
});
