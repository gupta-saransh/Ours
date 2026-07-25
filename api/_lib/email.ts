import { errorFields, log } from './log';

/**
 * Transactional email, via Resend's REST API.
 *
 * Shaped like push.ts on purpose: one send function that NEVER throws, always
 * returns a machine-readable outcome, and logs every attempt with a `reason`
 * you can search for when someone says "the reset email never arrived". We call
 * the HTTP API with global fetch rather than pulling in the `resend` npm
 * package, the same way we use `web-push` for push but avoided a dependency for
 * one call elsewhere.
 *
 * SENDING DOMAIN: Resend refuses to send from a domain you have not verified.
 * Until a real domain is verified (an SPF/DKIM DNS step, done outside the code),
 * RESEND_FROM defaults to Resend's shared `onboarding@resend.dev` sender, which
 * only delivers to the address on your own Resend account. Verifying a domain
 * and setting RESEND_FROM to e.g. "Ours <no-reply@yourdomain>" is the only
 * change needed to reach real users, no code edit.
 */

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

/** The default test sender that works with no verified domain (self only). */
const DEFAULT_FROM = 'Ours <onboarding@resend.dev>';

export type EmailReason =
  | 'not-configured' // RESEND_API_KEY is unset
  | 'send-failed'; // Resend turned the request away

export interface EmailResult {
  delivered: boolean;
  reason?: EmailReason;
}

export function emailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY;
}

/** The address emails are sent from (verified-domain address, or the test sender). */
function fromAddress(): string {
  return process.env.RESEND_FROM?.trim() || DEFAULT_FROM;
}

/**
 * Send one email. `source` names the caller (e.g. 'password-reset') so a log
 * search can answer "did the reset mail go out". Never throws.
 */
export async function sendEmail(
  to: string,
  subject: string,
  text: string,
  source = 'unknown'
): Promise<EmailResult> {
  const done = (result: EmailResult, extra: Record<string, unknown> = {}): EmailResult => {
    log(result.delivered ? 'info' : 'error', 'email.send', {
      source,
      delivered: result.delivered,
      reason: result.reason,
      // Never the recipient address or the body: the address identifies a
      // person and the body can carry a code. The domain is enough to trace.
      to_domain: to.split('@')[1],
      ...extra,
    });
    return result;
  };

  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) {
    // Loud, not silent: a missing key means resets are quietly broken.
    return done({ delivered: false, reason: 'not-configured' });
  }

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: fromAddress(), to, subject, text }),
    });
    if (!res.ok) {
      // Resend's own explanation (unverified domain, bad key, rate limit).
      const body = await res.text().catch(() => '');
      return done({ delivered: false, reason: 'send-failed' }, {
        http_status: res.status,
        provider_body: body.slice(0, 300),
      });
    }
    return done({ delivered: true });
  } catch (err) {
    return done({ delivered: false, reason: 'send-failed' }, errorFields(err));
  }
}
