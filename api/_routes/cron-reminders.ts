import { q, one } from '../_lib/db';
import { missingVapidVars, sendPush } from '../_lib/push';
import { pickDateReminder } from '../_lib/date-reminders';
import { dueForCountdown, type MilestoneRow } from '../_lib/milestone-countdown';
import { hasUnplayedRound, type AnswerRow } from '../_lib/game-rounds';
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
 *   ?kind=game   This-or-That nudge: anyone whose couple has a round of the
 *                daily game open that THEY have not played yet gets a push.
 *                Run twice a day (afternoon and evening); the second round
 *                opens a few hours after the first is settled, so the two runs
 *                naturally cover one round each without ever nudging someone
 *                about a question they already answered.
 *   ?kind=milestone countdown reminders: for every milestone whose countdown
 *                window is open (see api/_lib/milestone-countdown.ts,
 *                notify_days_before, 0 = off, 7 by default), both partners get
 *                a push once a day ("N days to {label}", or "Today is..." on
 *                the day itself), tracked by last_reminded_date so a retried
 *                or re-run cron never double-sends the same day. Run once a
 *                day. Milestone titles are plaintext (not encrypted), so the
 *                push body can safely name the day; a birthday resolves to the
 *                actual name of whoever's it is rather than the raw title.
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
          url: '/timeline',
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

  if (kind === 'game') {
    // Two runs a day cover the day's two questions. Whether a person actually
    // has something to play is decided by hasUnplayedRound (pure, shared with
    // the game route), so a run that lands between rounds nudges nobody rather
    // than nagging people about a question they already answered.
    const gameDate = new Date().toISOString().slice(0, 10);

    const users = await q<{
      id: string;
      couple_id: string;
      notifications_enabled: boolean;
      has_subscription: boolean;
      members: number;
    }>(
      `SELECT u.id, u.couple_id, u.notifications_enabled,
              (u.push_token IS NOT NULL) AS has_subscription,
              (SELECT count(*) FROM users m WHERE m.couple_id = u.couple_id) AS members
       FROM users u
       WHERE u.couple_id IS NOT NULL`
    );

    // One query for every answer of the day, grouped in JS. Never one query per
    // couple (see the admin dashboard's N+1 lesson in CLAUDE.md).
    const answers = await q<AnswerRow & { couple_id: string }>(
      `SELECT couple_id, user_id, pick, guess, pick2, guess2, created_at::STRING AS created_at
       FROM daily_game_answers WHERE game_date = $1`,
      [gameDate]
    ).catch(() => [] as (AnswerRow & { couple_id: string })[]); // pre-v16/v18 deploy

    const byCouple = new Map<string, AnswerRow[]>();
    for (const a of answers) {
      const list = byCouple.get(a.couple_id) ?? [];
      list.push(a);
      byCouple.set(a.couple_id, list);
    }

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
      // The game only pays off when both of you play, so never invite someone
      // to play it alone.
      if (Number(u.members) < 2) {
        skipped.push('solo-space');
        continue;
      }
      if (!hasUnplayedRound(byCouple.get(u.couple_id) ?? [], u.id)) {
        skipped.push('nothing-open');
        continue;
      }
      const result = await sendPush(
        u.id,
        {
          title: 'Ours',
          body: 'This or That is waiting. Two taps, then see how well you know each other. ♥',
          url: '/',
        },
        'cron:game'
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

  if (kind === 'milestone') {
    const today = new Date().toISOString().slice(0, 10);
    const rows = await q<MilestoneRow & { couple_id: string; title: string; person_name: string | null }>(
      `SELECT m.id, m.couple_id, m.title, m.date::STRING AS date, m.kind, m.person_id,
              m.notify_days_before, m.last_reminded_date::STRING AS last_reminded_date,
              u.display_name AS person_name
       FROM milestones m
       LEFT JOIN users u ON u.id = m.person_id
       WHERE m.notify_days_before > 0`
    );
    const due = dueForCountdown(rows, today);
    const byId = new Map(rows.map((r) => [r.id, r]));

    const failed: (string | undefined)[] = [];
    let sent = 0;
    let recipients = 0;

    for (const d of due) {
      const m = byId.get(d.id)!;
      const label = m.kind === 'birthday' && m.person_name ? `${m.person_name}'s birthday` : m.title;
      const body = d.daysUntil === 0 ? `Today is ${label}! ♥` : `${d.daysUntil} ${d.daysUntil === 1 ? 'day' : 'days'} to ${label}. ♥`;

      const partners = await q<{ id: string }>(
        `SELECT id FROM users WHERE couple_id = $1 AND notifications_enabled = true AND push_token IS NOT NULL`,
        [m.couple_id]
      );
      recipients += partners.length;
      for (const p of partners) {
        const out = await sendPush(p.id, { title: 'Ours', body, url: '/milestones' }, 'cron:milestone');
        if (out.delivered) sent += 1;
        else failed.push(out.reason);
      }
      await one('UPDATE milestones SET last_reminded_date = $2 WHERE id = $1 RETURNING id', [m.id, today]);
    }

    const report = {
      kind,
      milestones_checked: rows.length,
      due: due.length,
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
