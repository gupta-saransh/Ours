import { route } from '../_lib/respond';

/**
 * GET /api/push/vapid-public-key — the VAPID public key the browser needs to
 * subscribe. Public by design (it is the *public* half), so no auth required.
 */
export default route(['GET'], async (_req, res) => {
  res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY ?? null });
});
