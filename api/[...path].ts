import type { VercelRequest, VercelResponse } from '@vercel/node';

import authSignup from './_routes/auth-signup';
import authLogin from './_routes/auth-login';
import authMe from './_routes/auth-me';
import authAccount from './_routes/auth-account';
import authProfile from './_routes/auth-profile';
import coupleCreate from './_routes/couple-create';
import coupleJoin from './_routes/couple-join';
import coupleGet from './_routes/couple-get';
import memories from './_routes/memories';
import notes from './_routes/notes';
import noteItem from './_routes/note-item';
import milestones from './_routes/milestones';
import milestoneItem from './_routes/milestone-item';
import nudge from './_routes/nudge';
import ablyToken from './_routes/ably-token';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/**
 * The entire API is ONE serverless function (Vercel Hobby caps deployments at
 * 12). Handlers live in api/_routes/ — underscore-prefixed folders are never
 * deployed as functions — and this router dispatches to them.
 *
 * Adding an endpoint = new module in api/_routes/ + one entry here.
 * `:id` as the second segment binds to req.query.id, matching Vercel's own
 * [id].ts convention, so handlers are written exactly as before.
 */
const routes: Partial<Record<string, Handler>> = {
  'auth/signup': authSignup,
  'auth/login': authLogin,
  'auth/me': authMe,
  'auth/account': authAccount,
  'auth/profile': authProfile,
  'couple/create': coupleCreate,
  'couple/join': coupleJoin,
  couple: coupleGet,
  memories,
  notes,
  'notes/:id': noteItem,
  milestones,
  'milestones/:id': milestoneItem,
  nudge,
  'ably-token': ablyToken,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const raw = req.query.path;
  const segments = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter(Boolean);
  const path = segments.join('/');

  let match: Handler | undefined = routes[path];
  if (!match && segments.length === 2) {
    match = routes[`${segments[0]}/:id`];
    if (match) req.query.id = segments[1];
  }

  if (!match) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(404).json({ error: 'Not found' });
    return;
  }
  await match(req, res);
}
