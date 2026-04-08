// Private quiz analytics sink.
//
// Accepts POST events from /match/ and writes them to Supabase (table:
// quiz_sessions) via PostgREST using the service role key. Always returns
// 204 No Content so analytics failures never block the quiz-taker.
//
// Events:
//   start    -> INSERT new row (status='started', visitor env). Requires
//               a valid Cloudflare Turnstile token. Rate-limited to 20
//               starts/hour per IP. Fail-closed on analytics (no row) but
//               fail-open on UX (client never sees an error).
//   abandon  -> PATCH row by id with status='abandoned' + last_question_index
//               (filtered on status=eq.started so a completed row is never clobbered)
//   complete -> PATCH row by id with status='complete' + full score payload.
//               Also flags bot_suspect=true if started_at → completed_at < 15s.

import { verifyTurnstile } from './_turnstile.js';
import { ipToBestHem, hemToLinkedInUrl } from './_rb2b.js';

const ALLOWED_ORIGINS = [
  'https://eatcrayons.com',
  'https://www.eatcrayons.com',
  'https://eatcrayonshome.vercel.app',
];

const EVENT_TYPES = new Set(['start', 'abandon', 'complete']);
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIERS     = new Set(['exceptional', 'strong', 'nomatch']);

// Tuning knobs for the layer-2 heuristics
const IP_RATE_LIMIT_PER_HOUR = 20;
const MIN_QUIZ_DURATION_MS   = 15_000; // Under 15s end-to-end → bot-suspect

// RB2B enrichment: if we've already enriched this IP in the last 30 days,
// copy the prior result instead of burning fresh credits.
const RB2B_DEDUPE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

// Strip HTML tags and null bytes from a string
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').replace(/\0/g, '').trim();
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) : str;
}

// Coerce to string, sanitize, truncate, return null if empty
function sstr(v, max) {
  const s = truncate(sanitize(String(v ?? '')), max);
  return s || null;
}

function decodeHeader(v) {
  if (typeof v !== 'string') return null;
  try { return decodeURIComponent(v) || null; } catch { return v || null; }
}

function firstIp(xff) {
  if (typeof xff !== 'string' || !xff) return null;
  const first = xff.split(',')[0].trim();
  return first || null;
}

export default async function handler(req, res) {
  // CORS — only accept requests from known origins (or same-origin, which has no Origin header)
  const origin = req.headers.origin || '';
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  // Size guard — complete payload carries full answer dump
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 30_000) return res.status(413).json({ error: 'Payload too large' });

  // Parse body — some Vercel runtimes pre-parse, some pass raw text via sendBeacon
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  const event = typeof body.event === 'string' ? body.event : '';
  if (!EVENT_TYPES.has(event)) return res.status(400).json({ error: 'Invalid event' });

  const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
  if (!UUID_RE.test(sessionId)) return res.status(400).json({ error: 'Invalid session_id' });

  // Env vars — if missing, log and 204 so the client never sees failure
  const SUPABASE_URL  = process.env.SUPABASE_URL;
  const SERVICE_ROLE  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    console.error('quiz-event: Supabase env vars missing');
    return res.status(204).end();
  }

  const baseHeaders = {
    apikey:          SERVICE_ROLE,
    Authorization:   `Bearer ${SERVICE_ROLE}`,
    'Content-Type':  'application/json',
    Prefer:          'return=minimal',
  };
  const endpoint = `${SUPABASE_URL}/rest/v1/quiz_sessions`;

  try {
    if (event === 'start') {
      // ── Gate 1: Turnstile proof-of-human ────────────────────────────────
      // Fail-closed on analytics (skip insert) but fail-open on UX (still 204).
      // The client keeps running the quiz; we just don't log the session.
      const cfToken = typeof body.cf_token === 'string' ? body.cf_token : '';
      const humanOk = await verifyTurnstile(cfToken, req);
      if (!humanOk) {
        return res.status(204).end();
      }

      // Extract visitor environment from headers (server-side, never from client)
      const ip         = firstIp(req.headers['x-forwarded-for']);
      const userAgent  = sstr(req.headers['user-agent'], 500);
      const geoCountry = sstr(req.headers['x-vercel-ip-country'], 8);
      const geoRegion  = sstr(req.headers['x-vercel-ip-country-region'], 16);
      const geoCity    = sstr(decodeHeader(req.headers['x-vercel-ip-city']), 120);

      // ── Gate 2: IP rate limit ───────────────────────────────────────────
      // Max IP_RATE_LIMIT_PER_HOUR starts per IP per hour. Defence-in-depth
      // against scripts that solved (or bypassed) Turnstile somehow.
      if (ip) {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const rlUrl =
          `${endpoint}?ip=eq.${encodeURIComponent(ip)}` +
          `&started_at=gte.${encodeURIComponent(oneHourAgo)}` +
          `&select=id&limit=${IP_RATE_LIMIT_PER_HOUR + 1}`;
        try {
          const rlResp = await fetch(rlUrl, { headers: baseHeaders });
          if (rlResp.ok) {
            const rows = await rlResp.json();
            if (Array.isArray(rows) && rows.length >= IP_RATE_LIMIT_PER_HOUR) {
              console.warn('quiz-event: ip rate limit hit', ip);
              return res.status(204).end();
            }
          }
          // If the rate-limit check fails, fail-open (better than blocking real users)
        } catch (e) {
          console.error('quiz-event: rate-limit check failed', e && e.message);
        }
      }

      const row = {
        id:            sessionId,
        status:        'started',
        user_agent:    userAgent,
        ip:            ip,
        referrer:      sstr(body.referrer,     500),
        landing_path:  sstr(body.landing_path, 500),
        utm_source:    sstr(body.utm_source,   100),
        utm_medium:    sstr(body.utm_medium,   100),
        utm_campaign:  sstr(body.utm_campaign, 200),
        utm_term:      sstr(body.utm_term,     200),
        utm_content:   sstr(body.utm_content,  200),
        geo_country:   geoCountry,
        geo_region:    geoRegion,
        geo_city:      geoCity,
      };

      const response = await fetch(endpoint, {
        method:  'POST',
        headers: baseHeaders,
        body:    JSON.stringify(row),
      });

      // 409 = duplicate id (page reload mid-request). Idempotent — swallow.
      if (!response.ok && response.status !== 409) {
        const text = await response.text().catch(() => '');
        console.error('quiz-event start error:', response.status, text);
      }

      // ── RB2B enrichment (IP → hashed email → LinkedIn URL) ──────────────
      // Best-effort; wrapped in its own try/catch so any failure here is
      // invisible to the client. The row already exists, so the worst case
      // is an un-enriched session — which we can retry manually later.
      if (ip) {
        await enrichSessionWithRb2b({
          endpoint,
          baseHeaders,
          sessionId,
          ip,
          userAgent,
        });
      }

      return res.status(204).end();
    }

    if (event === 'abandon') {
      const lastIdx = Number.isInteger(body.last_question_index)
        ? Math.max(0, Math.min(100, body.last_question_index))
        : null;

      const patch = {
        status:              'abandoned',
        abandoned_at:        new Date().toISOString(),
        last_question_index: lastIdx,
      };

      // Filter on status=eq.started — a completed row is never overwritten
      const url = `${endpoint}?id=eq.${encodeURIComponent(sessionId)}&status=eq.started`;
      const response = await fetch(url, {
        method:  'PATCH',
        headers: baseHeaders,
        body:    JSON.stringify(patch),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        console.error('quiz-event abandon error:', response.status, text);
      }
      return res.status(204).end();
    }

    // event === 'complete'
    const scorePct = Number.isFinite(body.score_pct)
      ? Math.max(0, Math.min(100, Math.round(body.score_pct)))
      : null;
    const scoreTier = typeof body.score_tier === 'string' && TIERS.has(body.score_tier)
      ? body.score_tier
      : null;

    // flags: accept array of short strings
    let flags = null;
    if (Array.isArray(body.flags)) {
      flags = body.flags
        .filter(f => typeof f === 'string')
        .map(f => truncate(sanitize(f), 50))
        .filter(Boolean)
        .slice(0, 32);
      if (flags.length === 0) flags = null;
    }

    // answers: jsonb blob — cap its serialized size defensively
    let answers = null;
    if (body.answers && typeof body.answers === 'object' && !Array.isArray(body.answers)) {
      const serialized = JSON.stringify(body.answers);
      if (serialized.length <= 10_000) answers = body.answers;
    }

    // ── Gate 3: timing heuristic ──────────────────────────────────────────
    // Real humans take 60-180s to finish this quiz. A completion that
    // arrives < MIN_QUIZ_DURATION_MS after the start is almost certainly
    // automated. We flag these rather than drop them so they stay visible
    // in the dashboard — useful signal, not a hard block.
    const nowMs = Date.now();
    let botSuspect       = false;
    let botSuspectReason = null;
    try {
      const lookupUrl =
        `${endpoint}?id=eq.${encodeURIComponent(sessionId)}&select=started_at&limit=1`;
      const lookup = await fetch(lookupUrl, { headers: baseHeaders });
      if (lookup.ok) {
        const rows = await lookup.json();
        if (Array.isArray(rows) && rows.length === 1 && rows[0].started_at) {
          const startedMs = Date.parse(rows[0].started_at);
          if (Number.isFinite(startedMs)) {
            const deltaMs = nowMs - startedMs;
            if (deltaMs >= 0 && deltaMs < MIN_QUIZ_DURATION_MS) {
              botSuspect       = true;
              botSuspectReason = `completed in ${Math.round(deltaMs / 1000)}s (< 15s threshold)`;
            }
          }
        }
      }
    } catch (e) {
      console.error('quiz-event: timing check failed', e && e.message);
    }

    const patch = {
      status:             'complete',
      completed_at:       new Date(nowMs).toISOString(),
      score_pct:          scorePct,
      score_tier:         scoreTier,
      flags:              flags,
      answers:            answers,
      revenue_label:      sstr(body.revenue_label,   200),
      business_model:     sstr(body.business_model,  100),
      deal_size_label:    sstr(body.deal_size_label, 200),
      budget_label:       sstr(body.budget_label,    200),
      marketing_state:    sstr(body.marketing_state, 200),
      bot_suspect:        botSuspect,
      bot_suspect_reason: botSuspectReason,
    };

    // No status filter — complete is final and may arrive after a stale abandon
    const url = `${endpoint}?id=eq.${encodeURIComponent(sessionId)}`;
    const response = await fetch(url, {
      method:  'PATCH',
      headers: baseHeaders,
      body:    JSON.stringify(patch),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error('quiz-event complete error:', response.status, text);
    }
    return res.status(204).end();
  } catch (err) {
    console.error('quiz-event fetch error:', err && err.message ? err.message : err);
    return res.status(204).end();
  }
}

// RB2B enrichment flow — runs after a row is inserted on a 'start' event.
//
// 1. Dedupe: if this IP was already enriched successfully in the last 30
//    days, copy the prior { linkedin_url, hashed_email_md5, rb2b_score }
//    onto this new row without calling RB2B. Saves credits on repeat visits.
// 2. Otherwise call IP → HEM, pick the highest-confidence match, then
//    HEM → LinkedIn URL, and PATCH the row with the result.
// 3. On any failure, PATCH the row with rb2b_status set to a label so the
//    dashboard can surface what happened.
//
// Never throws. Always writes rb2b_status + rb2b_enriched_at so we can
// distinguish "not yet enriched" (null) from "tried and nothing back".
async function enrichSessionWithRb2b({ endpoint, baseHeaders, sessionId, ip, userAgent }) {
  try {
    const nowIso = new Date().toISOString();
    let patchBody = null;

    // ── Step 1: 30-day IP dedupe lookup ───────────────────────────────────
    const windowStart = new Date(Date.now() - RB2B_DEDUPE_WINDOW_MS).toISOString();
    const dedupeUrl =
      `${endpoint}?ip=eq.${encodeURIComponent(ip)}` +
      `&linkedin_url=not.is.null` +
      `&started_at=gte.${encodeURIComponent(windowStart)}` +
      `&id=neq.${encodeURIComponent(sessionId)}` +
      `&select=linkedin_url,hashed_email_md5,rb2b_score` +
      `&order=started_at.desc&limit=1`;
    try {
      const dedupeResp = await fetch(dedupeUrl, { headers: baseHeaders });
      if (dedupeResp.ok) {
        const rows = await dedupeResp.json();
        if (Array.isArray(rows) && rows.length === 1 && rows[0].linkedin_url) {
          patchBody = {
            hashed_email_md5: rows[0].hashed_email_md5,
            linkedin_url:     rows[0].linkedin_url,
            rb2b_score:       rows[0].rb2b_score,
            rb2b_status:      'deduped',
            rb2b_enriched_at: nowIso,
          };
        }
      }
    } catch (e) {
      console.error('rb2b dedupe lookup failed:', e && e.message);
    }

    // ── Step 2: Call RB2B if no dedupe hit ────────────────────────────────
    if (!patchBody) {
      const hem = await ipToBestHem(ip, userAgent);
      if (!hem) {
        patchBody = {
          rb2b_status:      'no_hem',
          rb2b_enriched_at: nowIso,
        };
      } else {
        const linkedinUrl = await hemToLinkedInUrl(hem.md5);
        patchBody = {
          hashed_email_md5: hem.md5,
          rb2b_score:       hem.score,
          linkedin_url:     linkedinUrl || null,
          rb2b_status:      linkedinUrl ? 'success' : 'no_linkedin',
          rb2b_enriched_at: nowIso,
        };
      }
    }

    // ── Step 3: Write enrichment back to the row ──────────────────────────
    const patchUrl = `${endpoint}?id=eq.${encodeURIComponent(sessionId)}`;
    const patchResp = await fetch(patchUrl, {
      method:  'PATCH',
      headers: baseHeaders,
      body:    JSON.stringify(patchBody),
    });
    if (!patchResp.ok) {
      const text = await patchResp.text().catch(() => '');
      console.error('rb2b enrichment patch error:', patchResp.status, text);
    }
  } catch (err) {
    console.error('rb2b enrichment error:', err && err.message ? err.message : err);
  }
}
