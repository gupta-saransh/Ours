import { q } from '../_lib/db';
import { sendPush } from '../_lib/push';
import { pickDateReminder } from '../_lib/date-reminders';
import { route, HttpError } from '../_lib/respond';

/**
 * Scheduled reminders. Called by GitHub Actions (see .github/workflows/), never
 * by the app, and gated by a shared secret in CRON_SECRET (unset = disabled).
 * A PWA cannot schedule its own notifications, so a cron pings this endpoint and
 * we deliver over Web Push.
 *
 *   ?kind=daily  end-of-day nudge: for every couple that added no memory and no
 *                note today, both partners get a gentle "keep one small thing"
 *                push. Run once a day, in the evening of your timezone.
 *   ?kind=dates  upcoming-date reminders: for each accepted, not-yet-happened
 *                date, both partners get a generic push at ~24h, ~6h, and ~1h
 *                before (one per threshold, tracked by flags). Run hourly.
 *
 * Writes no notification rows (a self-reminder should not crowd the bell) and
 * never reads couple content. Date reminders are intentionally generic (no
 * title) since the title is encrypted at rest.
 */
export default route(['POST', 'GET'], async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new HttpError(503, 'Reminders are not configured');
  const auth = req.headers.authorization ?? '';
  const provided = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : typeof req.query.key === 'string'
      ? req.query.key
      : '';
  if (provided !== secret) throw new HttpError(401, 'Not authorized');

  const kind = typeof req.query.kind === 'string' ? req.query.kind : 'daily';

  if (kind === 'daily') {
    // Users in a couple that has been quiet all day (UTC): no memory, no note.
    const users = await q<{ id: string }>(
      `SELECT u.id FROM users u
       WHERE u.couple_id IS NOT NULL
         AND u.notifications_enabled = true
         AND u.push_token IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM memories m
           WHERE m.couple_id = u.couple_id AND m.created_at >= date_trunc('day', now())
         )
         AND NOT EXISTS (
           SELECT 1 FROM love_notes n
           WHERE n.couple_id = u.couple_id AND n.created_at >= date_trunc('day', now())
         )`
    );

    let sent = 0;
    for (const u of users) {
      const r = await sendPush(u.id, {
        title: 'Ours',
        body: 'The day is winding down. Add a memory or a little note before it slips away. ♥',
        url: '/memories',
      });
      if (r.delivered) sent += 1;
    }
    res.status(200).json({ kind, checked: users.length, sent });
    return;
  }

  if (kind === 'dates') {
    // Accepted, not-yet-logged dates with a date set. Combine the date with the
    // time (default 19:00 if none) into a UTC instant and measure hours away.
    const rows = await q<{
      id: string;
      couple_id: string;
      hours_until: number;
      reminded_24: boolean;
      reminded_6: boolean;
      reminded_1: boolean;
    }>(
      `SELECT id, couple_id,
              EXTRACT(EPOCH FROM (
                (proposed_for::TIMESTAMP + (COALESCE(NULLIF(proposed_time, ''), '19:00') || ':00')::INTERVAL)::TIMESTAMPTZ - now()
              )) / 3600.0 AS hours_until,
              reminded_24, reminded_6, reminded_1
       FROM date_proposals
       WHERE status = 'accepted' AND completed_at IS NULL AND proposed_for IS NOT NULL
         AND proposed_for >= (now() - INTERVAL '2 days')::DATE
         AND proposed_for <= (now() + INTERVAL '2 days')::DATE`
    );

    let sent = 0;
    for (const r of rows) {
      const decision = pickDateReminder(Number(r.hours_until), {
        reminded_24: r.reminded_24,
        reminded_6: r.reminded_6,
        reminded_1: r.reminded_1,
      });
      if (!decision) continue;

      const partners = await q<{ id: string }>(
        `SELECT id FROM users WHERE couple_id = $1 AND notifications_enabled = true AND push_token IS NOT NULL`,
        [r.couple_id]
      );
      for (const p of partners) {
        const out = await sendPush(p.id, { title: 'Ours', body: decision.body, url: '/dates' });
        if (out.delivered) sent += 1;
      }
      await q('UPDATE date_proposals SET reminded_24 = $2, reminded_6 = $3, reminded_1 = $4 WHERE id = $1', [
        r.id,
        decision.flags.reminded_24,
        decision.flags.reminded_6,
        decision.flags.reminded_1,
      ]);
    }
    res.status(200).json({ kind, checked: rows.length, sent });
    return;
  }

  throw new HttpError(400, `Unknown reminder kind "${kind}"`);
});
