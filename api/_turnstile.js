// Cloudflare Turnstile server-side verification helper.
//
// Usage:
//   import { verifyTurnstile } from './_turnstile.js';
//   const ok = await verifyTurnstile(token, req);
//
// Docs: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
//
// Env: TURNSTILE_SECRET_KEY  (set in Vercel → Environment Variables)
//
// Returns true on successful verification, false on anything else. Never throws.

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function firstIp(xff) {
  if (typeof xff !== 'string' || !xff) return null;
  const first = xff.split(',')[0].trim();
  return first || null;
}

export async function verifyTurnstile(token, req) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('turnstile: TURNSTILE_SECRET_KEY env var not set');
    return false;
  }
  if (typeof token !== 'string' || !token || token.length > 2048) {
    return false;
  }

  // Include remoteip as a signal — Cloudflare uses it to cross-check the token
  const ip = firstIp(req && req.headers && req.headers['x-forwarded-for']);

  const form = new URLSearchParams();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);

    const response = await fetch(VERIFY_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body:    form.toString(),
      signal:  controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error('turnstile: siteverify http', response.status);
      return false;
    }
    const data = await response.json().catch(() => null);
    if (!data || data.success !== true) {
      // data['error-codes'] is the authoritative reason list from Cloudflare
      console.error('turnstile: verify failed', data && data['error-codes']);
      return false;
    }
    return true;
  } catch (err) {
    console.error('turnstile: fetch error', err && err.message ? err.message : err);
    return false;
  }
}
