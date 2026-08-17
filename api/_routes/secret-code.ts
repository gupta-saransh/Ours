import { one } from '../_lib/db';
import { hashPassword, requireUser, verifyPassword } from '../_lib/auth';
import { signSecretToken } from '../_lib/secret-session';
import {
  codeGateState,
  isValidCode,
  lockoutRemainingMinutes,
  lockoutUntil,
} from '../_lib/secret-chat';
import { route, requireString, HttpError } from '../_lib/respond';
import { log } from '../_lib/log';

/**
 * The lock on the secret chat.
 *   GET    /api/secret/code                     do I have a code, and am I locked out
 *   POST   /api/secret/code   { password, code } set or reset it (account password required)
 *   POST   /api/secret/unlock { code }           exchange the code for a 15-minute grant
 *
 * The code is a GATE, never a key: four digits is 10,000 combinations, so
 * deriving any encryption from it would be theatre. It is scrypt-hashed with
 * the same helpers the account password uses, which also means it can be
 * RESET but never revealed. (Showing someone their existing code would require
 * storing it reversibly, which is both weaker and more work than a reset form.)
 *
 * Setting a code for the FIRST time still requires the account password. That
 * is not belt-and-braces: without it, somebody holding an unlocked phone could
 * set a code and lock the actual owner out of their own secret thread.
 */

const LOCKED_MESSAGE = 'Too many tries. You can reset your code in Settings, under Privacy.';

interface CodeRow {
  secret_code_hash: string | null;
  secret_code_failures: number;
  secret_code_locked_until: string | null;
  password_hash: string;
}

async function loadCodeRow(userId: string): Promise<CodeRow> {
  const row = await one<CodeRow>(
    `SELECT secret_code_hash, secret_code_failures, secret_code_locked_until::STRING AS secret_code_locked_until,
            password_hash
     FROM users WHERE id = $1`,
    [userId]
  );
  if (!row) throw new HttpError(401, 'Account no longer exists');
  return row;
}

export default route(['GET', 'POST'], async (req, res) => {
  const user = await requireUser(req);
  const sub = (req.url ?? '').split('?')[0].replace(/\/+$/, '');
  const isUnlock = sub.endsWith('/unlock');

  // ---- Status (drives the Settings row and the lock screen's copy) ----
  if (req.method === 'GET') {
    const row = await loadCodeRow(user.id);
    const waitMinutes = lockoutRemainingMinutes(row.secret_code_locked_until);
    res.status(200).json({
      hasCode: !!row.secret_code_hash,
      lockedOut: waitMinutes > 0,
      waitMinutes,
    });
    return;
  }

  // ---- Unlock: trade the code for a short-lived grant ----
  if (isUnlock) {
    const code = typeof req.body?.code === 'string' ? req.body.code : '';
    const row = await loadCodeRow(user.id);
    const gate = codeGateState(row);

    if (gate === 'unset') throw new HttpError(400, 'Set a code first, in Settings under Privacy');
    if (gate === 'locked') {
      // Counted as a real event: repeated lockouts are the signature of someone
      // guessing. No code, no attempt value, nothing about the thread is logged.
      log('warn', 'secret.unlock_locked_out', { user_id: user.id });
      throw new HttpError(429, LOCKED_MESSAGE);
    }

    // Shape-check before hashing so a malformed body never costs a scrypt run.
    const ok = isValidCode(code) && verifyPassword(code, row.secret_code_hash!);
    if (!ok) {
      const failures = (row.secret_code_failures ?? 0) + 1;
      const until = lockoutUntil(failures);
      await one(
        'UPDATE users SET secret_code_failures = $2, secret_code_locked_until = $3 WHERE id = $1 RETURNING id',
        [user.id, failures, until]
      );
      log('warn', 'secret.unlock_failed', { user_id: user.id, failures });
      if (until) throw new HttpError(429, LOCKED_MESSAGE);
      throw new HttpError(401, 'That code is not right. You can reset it in Settings, under Privacy.');
    }

    await one(
      'UPDATE users SET secret_code_failures = 0, secret_code_locked_until = NULL WHERE id = $1 RETURNING id',
      [user.id]
    );
    const grant = signSecretToken(user.id);
    log('info', 'secret.unlocked', { user_id: user.id });
    res.status(200).json(grant);
    return;
  }

  // ---- Set or reset the code (account password required either way) ----
  const password = requireString(req.body?.password, 'Password', 200);
  const code = typeof req.body?.code === 'string' ? req.body.code : '';
  if (!isValidCode(code)) throw new HttpError(400, 'Your code needs to be 4 digits');

  const row = await loadCodeRow(user.id);
  if (!verifyPassword(password, row.password_hash)) {
    log('warn', 'secret.code_set_bad_password', { user_id: user.id });
    throw new HttpError(400, 'That password is not right');
  }

  // Setting a code also clears any lockout: proving the account password is a
  // stronger claim than the 4 digits, so it would be perverse to keep waiting.
  await one(
    `UPDATE users
     SET secret_code_hash = $2, secret_code_failures = 0, secret_code_locked_until = NULL
     WHERE id = $1 RETURNING id`,
    [user.id, hashPassword(code)]
  );
  log('info', 'secret.code_set', { user_id: user.id, replaced: !!row.secret_code_hash });

  // Hand back a grant so setting the code drops you straight into the thread
  // rather than immediately asking for what you just typed.
  res.status(200).json({ ok: true, ...signSecretToken(user.id) });
});
