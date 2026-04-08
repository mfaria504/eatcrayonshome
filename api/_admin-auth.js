// Shared admin session helpers. NOT a Vercel route (leading underscore is
// excluded from the `api/` auto-routing convention). Imported by the three
// admin-* routes.
//
// Auth model:
//   - Single shared password, stored in Vercel env var ADMIN_PASSWORD.
//   - Login exchanges the password for an HttpOnly Secure cookie.
//   - Cookie value: "<expiry_ms>.<base64url(hmac_sha256(expiry_ms, ADMIN_PASSWORD))>"
//     The HMAC key is the password itself — a leaked cookie can't be forged
//     without it, and rotating the password auto-invalidates all sessions.
//   - 7-day sliding window is re-minted on every authenticated request.

import crypto from 'node:crypto';

export const COOKIE_NAME = 'ec_admin';
export const SESSION_MS  = 7 * 24 * 60 * 60 * 1000; // 7 days

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(expiry, secret) {
  return b64url(crypto.createHmac('sha256', secret).update(String(expiry)).digest());
}

// Constant-time password compare that tolerates length mismatch.
export function verifyPassword(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string' || !expected) {
    return false;
  }
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    // Dummy compare to equalize timing before bailing out.
    crypto.timingSafeEqual(b, b);
    return false;
  }
  return crypto.timingSafeEqual(a, b);
}

export function mintCookie(secret) {
  const expiry = Date.now() + SESSION_MS;
  const sig    = sign(expiry, secret);
  const value  = `${expiry}.${sig}`;
  // Max-Age in seconds
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}`;
}

export function clearCookie() {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

function parseCookies(header) {
  const out = {};
  if (typeof header !== 'string' || !header) return out;
  const parts = header.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Returns true if the request carries a valid, non-expired admin cookie.
export function verifyRequest(req, secret) {
  if (!secret) return false;
  const cookies = parseCookies(req.headers && req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return false;
  const dot = raw.indexOf('.');
  if (dot < 0) return false;
  const expiryStr = raw.slice(0, dot);
  const providedSig = raw.slice(dot + 1);
  const expiry = parseInt(expiryStr, 10);
  if (!expiry || !Number.isFinite(expiry)) return false;
  if (expiry < Date.now()) return false;
  const expectedSig = sign(expiry, secret);
  const a = Buffer.from(providedSig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length) {
    crypto.timingSafeEqual(b, b);
    return false;
  }
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
