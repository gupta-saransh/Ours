import { randomInt } from 'node:crypto';
import { one } from '../_lib/db';
import { requireUser } from '../_lib/auth';
import { route } from '../_lib/respond';

/**
 * GET /api/referral — your personal share code + how many friends joined with
 * it. The code is minted lazily on first ask and never changes. No reward
 * mechanics by design: relationship points stay about the two of you.
 *
 * The share link is /sign-up?ref=CODE; signup stores the referrer on the new
 * account's `referred_by` (see auth-signup.ts).
 */

// Same alphabet as invite codes (no 0/O/1/I); 8 chars so the two code spaces
// cannot collide in anyone's head.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function makeReferralCode(): string {
  let code = '';
  for (let i = 0; i < 8; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

export default route(['GET'], async (req, res) => {
  const user = await requireUser(req);

  let row = await one<{ referral_code: string | null }>('SELECT referral_code FROM users WHERE id = $1', [user.id]);
  if (!row?.referral_code) {
    // Mint on first ask; retry on the (rare) unique collision.
    for (let attempt = 0; attempt < 5 && !row?.referral_code; attempt++) {
      row = await one<{ referral_code: string }>(
        `UPDATE users SET referral_code = $2 WHERE id = $1 AND referral_code IS NULL RETURNING referral_code`,
        [user.id, makeReferralCode()]
      ).catch(() => undefined as any);
      if (!row) {
        // Either a collision (retry) or a concurrent mint (read it back).
        row = await one<{ referral_code: string | null }>('SELECT referral_code FROM users WHERE id = $1', [user.id]);
        if (row?.referral_code) break;
      }
    }
  }

  const joined = await one<{ n: number }>('SELECT count(*)::INT AS n FROM users WHERE referred_by = $1', [user.id]);

  res.status(200).json({
    code: row?.referral_code ?? null,
    joined: joined?.n ?? 0,
  });
});
