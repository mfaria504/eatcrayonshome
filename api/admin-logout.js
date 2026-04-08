// POST /api/admin-logout — clears the ec_admin cookie. Always returns 204.

import { clearCookie } from './_admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Set-Cookie', clearCookie());
  return res.status(204).end();
}
