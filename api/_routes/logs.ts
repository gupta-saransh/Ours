import type { VercelRequest } from '@vercel/node';
import { requireUser } from '../_lib/auth';
import { log } from '../_lib/log';
import { route } from '../_lib/respond';

/**
 * POST /api/logs — intake for client-side events (see src/lib/log.ts).
 *
 * Auth is OPTIONAL on purpose: the most interesting client failures happen on
 * the sign-in screen and around expired sessions, and dropping those would blind
 * exactly the case worth seeing. A signed-in batch gets its user stamped on.
 *
 * Everything here is untrusted input, so the batch is capped and each field is
 * flattened to a short primitive before it reaches the log pipeline.
 */

const MAX_EVENTS = 50;
const MAX_FIELDS = 15;
const MAX_VALUE = 200;

const LEVELS = new Set(['debug', 'info', 'warn', 'error']);

function sanitize(input: unknown): Record<string, string | number | boolean> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_FIELDS) break;
    if (value === null || value === undefined) continue;
    // Prefix so a client field can never collide with (or forge) a server one
    // like user_id, level, or event.
    const name = `c_${key.replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 40)}`;
    if (typeof value === 'string') out[name] = value.slice(0, MAX_VALUE);
    else if (typeof value === 'number' && Number.isFinite(value)) out[name] = value;
    else if (typeof value === 'boolean') out[name] = value;
  }
  return out;
}

/** requireUser throws when signed out; anonymous batches are still accepted. */
async function optionalUser(req: VercelRequest): Promise<{ id: string; couple_id: string | null } | null> {
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}

export default route(['POST'], async (req, res) => {
  const user = await optionalUser(req);
  const body = req.body ?? {};
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_EVENTS) : [];

  const batch = {
    source: 'client',
    session: typeof body.session === 'string' ? body.session.slice(0, 32) : undefined,
    platform: typeof body.platform === 'string' ? body.platform.slice(0, 16) : undefined,
    standalone: typeof body.standalone === 'boolean' ? body.standalone : undefined,
    user_id: user?.id,
    couple_id: user?.couple_id ?? undefined,
  };

  for (const raw of events) {
    if (!raw || typeof raw !== 'object') continue;
    const name = typeof raw.event === 'string' ? raw.event.slice(0, 60) : 'client.unknown';
    const level = typeof raw.level === 'string' && LEVELS.has(raw.level) ? raw.level : 'info';
    log(level as 'debug' | 'info' | 'warn' | 'error', name, {
      ...batch,
      // The client's own timestamp: batching means it can be seconds behind _time.
      client_time: typeof raw.t === 'string' ? raw.t.slice(0, 40) : undefined,
      ...sanitize(raw.fields),
    });
  }

  res.status(202).json({ received: events.length });
});
