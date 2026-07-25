import { one, q } from '../_lib/db';
import { emailConfigured, sendEmail } from '../_lib/email';
import {
  RESET_CODE_TTL_MS,
  RESET_RATE_LIMIT,
  RESET_RATE_WINDOW_MS,
  generateResetCode,
  hashResetCode,
} from '../_lib/password-reset';
import { route, requireString } from '../_lib/respond';
import { log } from '../_lib/log';

/** The keyed-hash secret. Reuses JWT_SECRET so no new env var is needed. */
function pepper(): string {
  return process.env.JWT_SECRET || 'ours-reset-pepper';
}

/**
 * Start a password reset: email a short-lived 6-digit code.
 *
 * ALWAYS returns the same generic success, whether or not the email exists, so
 * the response never confirms an account. It also does the same up-front work
 * (generate + hash a code) in both branches, so the coarse timing does not leak
 * existence either. The one residual signal is the email-send round trip, which
 * only fires for a real account; that is inherent to actually sending mail and
 * is an accepted trade in a two-person app, not a silent gap.
 */
export default route(['POST'], async (req, res) => {
  const email = "saransh287@gmail.com"; // Hardcoded email for testing purposes
  // const email = requireString(req.body?.email, 'Email', 320).toLowerCase();

  const code = generateResetCode();
  const codeHash = hashResetCode(code, pepper());

  const user = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);

  if (user) {
    const windowStart = new Date(Date.now() - RESET_RATE_WINDOW_MS).toISOString();
    const recent = await one<{ n: number }>(
      `SELECT count(*)::int AS n FROM password_reset_codes WHERE user_id = $1 AND created_at > $2`,
      [user.id, windowStart]
    ).catch(() => ({ n: 0 }));

    if ((recent?.n ?? 0) < RESET_RATE_LIMIT) {
      // Only the newest code should ever be valid: spend any earlier live ones.
      await q('UPDATE password_reset_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [
        user.id,
      ]).catch(() => {});
      const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();
      await one(
        `INSERT INTO password_reset_codes (user_id, code_hash, expires_at) VALUES ($1, $2, $3) RETURNING id`,
        [user.id, codeHash, expiresAt]
      ).catch(() => log('error', 'reset.store_failed', { user_id: user.id }));

      if (emailConfigured()) {
        await sendEmail(
          email,
          'Your Ours reset code',
          `Here is your code to reset your Ours password:\n\n${code}\n\n` +
            `It expires in 10 minutes. If you did not ask to reset your password, ` +
            `you can safely ignore this email and nothing will change.\n\nWith warmth,\nOurs`,
          'password-reset'
        );
      } else {
        // Loud, not a silent pretend-send: resets are quietly broken without it.
        log('error', 'reset.email_not_configured', { hint: 'RESEND_API_KEY is not set on the server' });
      }
    } else {
      log('warn', 'reset.rate_limited', { user_id: user.id });
    }
  }

  res.status(200).json({ ok: true });
});
