// GET /api/admin-quiz-data
// Requires a valid ec_admin cookie (see _admin-auth.js).
// Calls the public.admin_quiz_stats() Postgres function via PostgREST RPC
// and returns the aggregated JSON blob. Re-mints the session cookie on
// success (sliding 7-day window).

import { verifyRequest, mintCookie } from './_admin-auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const adminSecret = process.env.ADMIN_PASSWORD || '';
  if (!adminSecret) {
    console.error('admin-quiz-data: ADMIN_PASSWORD env var not set');
    return res.status(500).json({ error: 'Dashboard not configured' });
  }

  if (!verifyRequest(req, adminSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('admin-quiz-data: Supabase env vars missing');
    return res.status(500).json({ error: 'Dashboard backend not configured' });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/admin_quiz_stats`, {
      method:  'POST',
      headers: {
        apikey:         SERVICE_ROLE,
        Authorization:  `Bearer ${SERVICE_ROLE}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('admin-quiz-data rpc error:', response.status, text);
      return res.status(502).json({ error: 'Upstream error' });
    }

    const stats = await response.json();

    // Slide the session window: re-mint cookie on every successful read.
    res.setHeader('Set-Cookie', mintCookie(adminSecret));
    return res.status(200).json(stats || {});
  } catch (err) {
    console.error('admin-quiz-data fetch error:', err && err.message ? err.message : err);
    return res.status(502).json({ error: 'Upstream error' });
  }
}
