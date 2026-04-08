// POST /api/admin-login
// Body: { password: string }
// On success: Set-Cookie ec_admin + { ok: true }
// On failure: 401 after a ~300ms delay (rate-limiting friction)
//
// Env: ADMIN_PASSWORD (set in Vercel → Settings → Environment Variables)

import { verifyPassword, mintCookie } from './_admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.ADMIN_PASSWORD || '';
  if (!expected) {
    console.error('admin-login: ADMIN_PASSWORD env var not set');
    return res.status(500).json({ error: 'Admin login not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const provided = typeof body.password === 'string' ? body.password : '';

  if (!verifyPassword(provided, expected)) {
    // Small delay to slow down online guessing without being annoying
    await new Promise(r => setTimeout(r, 300));
    return res.status(401).json({ error: 'Invalid password' });
  }

  res.setHeader('Set-Cookie', mintCookie(expected));
  return res.status(200).json({ ok: true });
}
