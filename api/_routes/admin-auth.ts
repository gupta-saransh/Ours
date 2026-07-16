import { adminConfigured, signAdminToken, verifyAdminPassword } from '../_lib/admin';
import { route, requireString, HttpError } from '../_lib/respond';

/** POST /api/admin/auth { password } — the one gate for /admin/dashboard. */
export default route(['POST'], async (req, res) => {
  if (!adminConfigured()) throw new HttpError(503, 'Admin access is not configured');
  const password = requireString(req.body?.password, 'Password', 200);
  if (!verifyAdminPassword(password)) throw new HttpError(401, 'Incorrect password');
  res.status(200).json({ token: signAdminToken() });
});
