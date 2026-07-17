import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { notify } from '../_lib/notify';
import { encryptField, readField } from '../_lib/envelope';
import { route, requireString, HttpError } from '../_lib/respond';

// title/location/reflection are encrypted at rest (envelope.ts): each has a _ct
// column, resolved to plaintext in JS after the query.
export const PROPOSAL_COLUMNS = `id, proposer_id, title, title_ct, location, location_ct,
  proposed_for::STRING AS proposed_for, proposed_time, status, counter_of, milestone_id,
  rating, reflection, reflection_ct, memory_id, completed_at::STRING AS completed_at,
  created_at, updated_at`;

// Non-text columns, for RETURNING when we already hold the plaintext.
export const PROPOSAL_META_COLUMNS = `id, proposer_id, proposed_for::STRING AS proposed_for,
  proposed_time, status, counter_of, milestone_id, rating, memory_id,
  completed_at::STRING AS completed_at, created_at, updated_at`;

/** Decrypt title/location/reflection and drop the raw ciphertext columns. */
export async function decodeProposal(coupleId: string, row: Record<string, any>) {
  const { title_ct, location_ct, reflection_ct, ...rest } = row;
  return {
    ...rest,
    title: (await readField(coupleId, title_ct, rest.title)) ?? '',
    location: (await readField(coupleId, location_ct, rest.location)) ?? rest.location ?? null,
    reflection: (await readField(coupleId, reflection_ct, rest.reflection)) ?? rest.reflection ?? null,
  };
}

/** Decrypt a saved date idea (title/location only). */
export async function decodeIdea(coupleId: string, row: Record<string, any>) {
  const { title_ct, location_ct, ...rest } = row;
  return {
    ...rest,
    title: (await readField(coupleId, title_ct, rest.title)) ?? '',
    location: (await readField(coupleId, location_ct, rest.location)) ?? rest.location ?? null,
  };
}

export function parseTime(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string' || !/^\d{2}:\d{2}$/.test(raw)) throw new HttpError(400, 'proposedTime must be HH:MM');
  const [h, m] = raw.split(':').map(Number);
  if (h > 23 || m > 59) throw new HttpError(400, 'proposedTime must be a real time');
  return raw;
}

/**
 * GET  /api/dates  open proposals + the last 60 days of resolved ones, plus the
 *                  couple's saved date-idea pool (`ideas`).
 * POST /api/dates  propose a date { title, location?, proposedFor?, proposedTime? }
 */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);

  if (req.method === 'GET') {
    const [rows, ideaRows] = await Promise.all([
      q<Record<string, any>>(
        `SELECT ${PROPOSAL_COLUMNS} FROM date_proposals
         WHERE couple_id = $1 AND (status = 'open' OR status = 'accepted' OR updated_at > now() - INTERVAL '90 days')
         ORDER BY (status = 'open') DESC, updated_at DESC LIMIT 120`,
        [user.couple_id]
      ),
      q<Record<string, any>>(
        `SELECT id, title, title_ct, location, location_ct, created_by, times_used, created_at
         FROM date_ideas WHERE couple_id = $1 ORDER BY times_used ASC, created_at DESC LIMIT 50`,
        [user.couple_id]
      ),
    ]);
    const [proposals, ideas] = await Promise.all([
      Promise.all(rows.map((r) => decodeProposal(user.couple_id, r))),
      Promise.all(ideaRows.map((r) => decodeIdea(user.couple_id, r))),
    ]);
    res.status(200).json({ proposals, ideas });
    return;
  }

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
  const created = await one(
    `INSERT INTO date_proposals (couple_id, proposer_id, title, title_ct, location, location_ct, proposed_for, proposed_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${PROPOSAL_META_COLUMNS}`,
    [user.couple_id, user.id, titleCt ? '' : title, titleCt, locationCt ? null : location, locationCt, proposedFor, proposedTime]
  );
  const proposal = { ...created, title, location };
  await publish(user.couple_id, 'date.proposed', { id: (proposal as { id: string }).id, by: user.id });
  // Keep the encrypted title out of the plaintext notifications table.
  await notify(user.couple_id, user.id, 'date', `${user.display_name} proposed a date`);
  res.status(201).json({ proposal });
});
