import { one, q } from '../_lib/db';
import { requirePairedUser } from '../_lib/auth';
import { publish } from '../_lib/ably';
import { route } from '../_lib/respond';

export interface ReflectionPayload {
  week_start: string;
  week_end: string;
  counts: {
    memories: number;
    notes: number;
    prompts_together: number;
    hearts: number;
    bucket_added: number;
    nudges: number;
  };
  highlight: { id: string; thumb_data: string | null; note: string } | null;
  saved: boolean;
}

/**
 * Deterministic weekly recap, Monday to Sunday in UTC (kept simple for the
 * MVP; local-timezone weeks would need a per-user offset). Computed fresh on
 * read; saving persists a snapshot into weekly_reflections.
 */
export async function computeReflection(coupleId: string): Promise<ReflectionPayload> {
  const range = await one<{ ws: string; we: string }>(
    `SELECT date_trunc('week', now())::DATE::STRING AS ws,
            (date_trunc('week', now())::DATE + 7)::STRING AS we`
  );
  const ws = range!.ws;
  const we = range!.we;
  const win = `created_at >= $2::DATE AND created_at < $3::DATE`;

  const [memories, notes, prompts, hearts, bucket, nudges, highlightTop, highlightNew, saved] = await Promise.all([
    one<{ n: number }>(`SELECT count(*)::int AS n FROM memories WHERE couple_id = $1 AND ${win}`, [coupleId, ws, we]),
    one<{ n: number }>(`SELECT count(*)::int AS n FROM love_notes WHERE couple_id = $1 AND ${win}`, [coupleId, ws, we]),
    one<{ n: number }>(
      `SELECT count(*)::int AS n FROM (
         SELECT prompt_date FROM daily_prompt_answers
         WHERE couple_id = $1 AND prompt_date >= $2::DATE AND prompt_date < $3::DATE
         GROUP BY prompt_date HAVING count(*) = 2
       )`,
      [coupleId, ws, we]
    ),
    one<{ n: number }>(
      `SELECT count(*)::int AS n FROM memory_hearts h JOIN memories m ON m.id = h.memory_id
       WHERE m.couple_id = $1 AND h.created_at >= $2::DATE AND h.created_at < $3::DATE`,
      [coupleId, ws, we]
    ),
    one<{ n: number }>(`SELECT count(*)::int AS n FROM bucket_items WHERE couple_id = $1 AND ${win}`, [coupleId, ws, we]),
    one<{ n: number }>(
      `SELECT count(*)::int AS n FROM notifications WHERE couple_id = $1 AND kind = 'nudge' AND ${win}`,
      [coupleId, ws, we]
    ),
    // Highlight: most-hearted memory of the week, else the newest one.
    one(
      `SELECT m.id, m.thumb_data, m.note,
         (SELECT count(*) FROM memory_hearts h WHERE h.memory_id = m.id) AS hn
       FROM memories m WHERE m.couple_id = $1 AND m.${win}
       ORDER BY hn DESC, m.created_at DESC LIMIT 1`,
      [coupleId, ws, we]
    ),
    one(
      `SELECT id, thumb_data, note FROM memories
       WHERE couple_id = $1 AND ${win} ORDER BY created_at DESC LIMIT 1`,
      [coupleId, ws, we]
    ),
    one(`SELECT id FROM weekly_reflections WHERE couple_id = $1 AND week_start = $2::DATE`, [coupleId, ws]),
  ]);

  const highlightRow: any = highlightTop ?? highlightNew ?? null;
  return {
    week_start: ws,
    week_end: we,
    counts: {
      memories: memories?.n ?? 0,
      notes: notes?.n ?? 0,
      prompts_together: prompts?.n ?? 0,
      hearts: hearts?.n ?? 0,
      bucket_added: bucket?.n ?? 0,
      nudges: nudges?.n ?? 0,
    },
    highlight: highlightRow ? { id: highlightRow.id, thumb_data: highlightRow.thumb_data, note: highlightRow.note } : null,
    saved: !!saved,
  };
}

/** GET /api/reflection (this week) · POST /api/reflection (save) · GET /api/reflection/history */
export default route(['GET', 'POST'], async (req, res) => {
  const user = await requirePairedUser(req);
  const isHistory = (req.url ?? '').split('?')[0].endsWith('/history');

  if (isHistory) {
    const reflections = await q(
      `SELECT id, week_start::STRING AS week_start, counts, highlight_memory_id, created_at
       FROM weekly_reflections WHERE couple_id = $1 ORDER BY week_start DESC LIMIT 60`,
      [user.couple_id]
    );
    res.status(200).json({ reflections });
    return;
  }

  const payload = await computeReflection(user.couple_id);

  if (req.method === 'POST') {
    await one(
      `INSERT INTO weekly_reflections (couple_id, week_start, counts, highlight_memory_id, saved_by)
       VALUES ($1, $2::DATE, $3, $4, $5)
       ON CONFLICT (couple_id, week_start) DO NOTHING`,
      [user.couple_id, payload.week_start, JSON.stringify(payload.counts), payload.highlight?.id ?? null, user.id]
    );
    await publish(user.couple_id, 'reflection.saved', { week_start: payload.week_start });
    res.status(200).json({ ...payload, saved: true });
    return;
  }

  res.status(200).json(payload);
});
