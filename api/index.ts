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
import memoryItem from './_routes/memory-item';
import memoryComments from './_routes/memory-comments';
import commentItem from './_routes/comment-item';
import notes from './_routes/notes';
import noteItem from './_routes/note-item';
import milestones from './_routes/milestones';
import milestoneItem from './_routes/milestone-item';
import notifications from './_routes/notifications';
import bucket from './_routes/bucket';
import bucketItem from './_routes/bucket-item';
import home from './_routes/home';
import prompts from './_routes/prompts';
import dates from './_routes/dates';
import dateItem from './_routes/date-item';
import wishlist from './_routes/wishlist';
import wishlistItem from './_routes/wishlist-item';
import reflection from './_routes/reflection';
import pushSubscribe from './_routes/push-subscribe';
import pushVapid from './_routes/push-vapid';
import nudge from './_routes/nudge';
import ablyToken from './_routes/ably-token';
import adminAuth from './_routes/admin-auth';
import adminStats from './_routes/admin-stats';

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<void>;

/**
 * The entire API is ONE serverless function (Vercel Hobby caps deployments at
 * 12 functions). vercel.json rewrites /api/* here; the original path arrives
 * untouched on req.url. Handlers live in api/_routes/ — underscore-prefixed
 * folders are never deployed as functions.
 *
 * Adding an endpoint = new module in api/_routes/ + one entry in this table.
 * ':id' as the second segment binds to req.query.id, matching Vercel's own
 * [id].ts convention, so handlers are written exactly as standalone ones.
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
  'memories/:id': memoryItem,
  comments: memoryComments,
  'comments/:id': commentItem,
  notes,
  'notes/:id': noteItem,
  milestones,
  'milestones/:id': milestoneItem,
  notifications,
  bucket,
  'bucket/:id': bucketItem,
  home,
  'prompt/today': prompts,
  'prompt/history': prompts,
  dates,
  'dates/:id': dateItem,
  wishlist,
  'wishlist/:id': wishlistItem,
  reflection,
  'reflection/history': reflection,
  'push/subscribe': pushSubscribe,
  'push/vapid-public-key': pushVapid,
  nudge,
  'ably-token': ablyToken,
  'admin/auth': adminAuth,
  'admin/stats': adminStats,
};

function pathSegments(req: VercelRequest): string[] {
  // Rewrites preserve the original URL; fall back to the ?path= query param
  // that the rewrite appends, in case a platform version changes behavior.
  const pathname = (req.url ?? '').split('?')[0];
  let rel = pathname.replace(/^\/api\/?/, '');
  if (!rel) {
    const raw = req.query.path;
    rel = Array.isArray(raw) ? raw.join('/') : (raw ?? '');
  }
  return rel.split('/').filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const segments = pathSegments(req);
  const path = segments.join('/');

  let match = routes[path];
  if (!match && segments.length === 2) {
    match = routes[`${segments[0]}/:id`];
    if (match) req.query.id = segments[1];
  }

  if (!match) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(404).json({ error: `No API route for "${path}"` });
    return;
  }
  await match(req, res);
}
