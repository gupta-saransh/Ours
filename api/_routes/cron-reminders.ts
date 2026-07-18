import { q } from '../_lib/db';
import { missingVapidVars, sendPush } from '../_lib/push';
import { pickDateReminder } from '../_lib/date-reminders';
import { log } from '../_lib/log';
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
 *   ?kind=prompt morning nudge: anyone who has not answered today's question
 *                yet gets a push pointing at it. Run once a day, in the
 *                morning of your timezone.
 *
 * Writes no notification rows (a self-reminder should not crowd the bell) and
 * never reads couple content. Date reminders are intentionally generic (no
 * title) since the title is encrypted at rest.
 *
 * DEBUGGING: the response body is a full report (who was considered, who was
 * skipped and why, what was delivered), and the workflow prints it, so a green
 * Actions run that sent nothing tells you *why* right there in the job log. The
 * same report is logged as `cron.summary` for Axiom.
 */

/** Count occurrences of each skip/failure reason for the report. */
function tally(reasons: (string | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const reason of reasons) {
    const key = reason ?? 'unknown';
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export default route(['POST', 'GET'], async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : 'daily';
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    log('error', 'cron.not_configured', { kind, hint: 'CRON_SECRET is not set on the server' });
    throw new HttpError(503, 'Reminders are not configured');
  }
  const auth = req.headers.authorization ?? '';
  const provided = auth.startsWith('Bearer ')
    ? auth.slice(7)
    : typeof req.query.key === 'string'
      ? req.query.key
      : '';
  if (provided !== secret) {
    // Almost always the repo secret and the Vercel env var drifting apart.
    log('warn', 'cron.unauthorized', { kind, had_bearer: auth.startsWith('Bearer '), presented_length: provided.length });
    throw new HttpError(401, 'Not authorized');
  }

  const startedAt = Date.now();
  // A missing VAPID key set means nothing can ever be delivered; say so loudly
  // rather than reporting a cheerful "sent: 0".
  const missingVapid = missingVapidVars();

  if (kind === 'daily') {
    // Every paired user, with the facts that decide whether they get a nudge, so
    // the report can explain each skip instead of just counting the survivors.
    const users = await q<{
      id: string;
      notifications_enabled: boolean;
      has_subscription: boolean;
      active_today: boolean;
    }>(
      `SELECT u.id,
              u.notifications_enabled,
              (u.push_token IS NOT NULL) AS has_subscription,
              (EXISTS (
                 SELECT 1 FROM memories m
                 WHERE m.couple_id = u.couple_id AND m.created_at >= date_trunc('day', now())
               ) OR EXISTS (
                 SELECT 1 FROM love_notes n
                 WHERE n.couple_id = u.couple_id AND n.created_at >= date_trunc('day', now())
               )) AS active_today
       FROM users u
       WHERE u.couple_id IS NOT NULL`
    );

    const skipped: string[] = [];
    const failed: (string | undefined)[] = [];
    let sent = 0;

    for (const u of users) {
      if (!u.notifications_enabled) {
        skipped.push('notifications-off');
        continue;
      }
      if (!u.has_subscription) {
        skipped.push('no-subscription');
        continue;
      }
      if (u.active_today) {
        skipped.push('already-wrote-today');
        continue;
      }
      const result = await sendPush(
        u.id,
        {
          title: 'Ours',
          body: 'The day is winding down. Add a memory or a little note before it slips away. ♥',
          url: '/memories',
        },
        'cron:daily'
      );
      if (result.delivered) sent += 1;
      else failed.push(result.reason);
    }

    const report = {
      kind,
      users: users.length,
      eligible: users.length - skipped.length,
      sent,
      skipped: tally(skipped),
      failed: tally(failed),
      missing_vapid_env: missingVapid,
      duration_ms: Date.now() - startedAt,
    };
    log(sent === 0 && report.eligible > 0 ? 'warn' : 'info', 'cron.summary', report);
    res.status(200).json(report);
    return;
  }

  if (kind === 'prompt') {
    // Every paired user who has not answered today's (UTC) prompt yet, with the
    // facts that decide each skip, so the report explains itself like daily's.
    const users = await q<{
      id: string;
      notifications_enabled: boolean;
      has_subscription: boolean;
      answered_today: boolean;
    }>(
      `SELECT u.id,
              u.notifications_enabled,
              (u.push_token IS NOT NULL) AS has_subscription,
              EXISTS (
                SELECT 1 FROM daily_prompt_answers a
                WHERE a.user_id = u.id AND a.prompt_date = current_date
              ) AS answered_today
       FROM users u
       WHERE u.couple_id IS NOT NULL`
    );

    const skipped: string[] = [];
    const failed: (string | undefined)[] = [];
    let sent = 0;

    for (const u of users) {
      if (!u.notifications_enabled) {
        skipped.push('notifications-off');
        continue;
      }
      if (!u.has_subscription) {
        skipped.push('no-subscription');
        continue;
      }
      if (u.answered_today) {
        skipped.push('already-answered');
        continue;
      }
      const result = await sendPush(
        u.id,
        {
          title: 'Ours',
          body: 'A fresh question is waiting for you both. Answer yours to see theirs. ♥',
          url: '/prompts',
        },
        'cron:prompt'
      );
      if (result.delivered) sent += 1;
      else failed.push(result.reason);
    }

    const report = {
      kind,
      users: users.length,
      eligible: users.length - skipped.length,
      sent,
      skipped: tally(skipped),
      failed: tally(failed),
      missing_vapid_env: missingVapid,
      duration_ms: Date.now() - startedAt,
    };
    log(sent === 0 && report.eligible > 0 ? 'warn' : 'info', 'cron.summary', report);
    res.status(200).json(report);
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

    const failed: (string | undefined)[] = [];
    let due = 0;
    let sent = 0;
    let recipients = 0;

    for (const r of rows) {
      const hoursUntil = Number(r.hours_until);
      const decision = pickDateReminder(hoursUntil, {
        reminded_24: r.reminded_24,
        reminded_6: r.reminded_6,
        reminded_1: r.reminded_1,
      });
      // Per-date detail: the id and hours are enough to replay a missed window.
      log('info', 'cron.date_checked', {
        date_id: r.id,
        couple_id: r.couple_id,
        hours_until: Math.round(hoursUntil * 100) / 100,
        threshold_sent: decision ? 'yes' : 'no',
        reminded_24: r.reminded_24,
        reminded_6: r.reminded_6,
        reminded_1: r.reminded_1,
      });
      if (!decision) continue;
      due += 1;

      const partners = await q<{ id: string }>(
        `SELECT id FROM users WHERE couple_id = $1 AND notifications_enabled = true AND push_token IS NOT NULL`,
        [r.couple_id]
      );
      recipients += partners.length;
      for (const p of partners) {
        const out = await sendPush(p.id, { title: 'Ours', body: decision.body, url: '/dates' }, 'cron:dates');
        if (out.delivered) sent += 1;
        else failed.push(out.reason);
      }
      await q('UPDATE date_proposals SET reminded_24 = $2, reminded_6 = $3, reminded_1 = $4 WHERE id = $1', [
        r.id,
        decision.flags.reminded_24,
        decision.flags.reminded_6,
        decision.flags.reminded_1,
      ]);
    }

    const report = {
      kind,
      dates_in_window: rows.length,
      due,
      recipients,
      sent,
      failed: tally(failed),
      missing_vapid_env: missingVapid,
      duration_ms: Date.now() - startedAt,
    };
    log(sent === 0 && recipients > 0 ? 'warn' : 'info', 'cron.summary', report);
    res.status(200).json(report);
    return;
  }

  throw new HttpError(400, `Unknown reminder kind "${kind}"`);
});
