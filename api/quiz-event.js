// Private quiz analytics sink.
//
// Accepts POST events from /match/ and writes them to Supabase (table:
// quiz_sessions) via PostgREST using the service role key. Always returns
// 204 No Content so analytics failures never block the quiz-taker.
//
// Events:
//   start    -> INSERT new row (status='started', visitor env)
//   abandon  -> PATCH row by id with status='abandoned' + last_question_index
//               (filtered on status=eq.started so a completed row is never clobbered)
//   complete -> PATCH row by id with status='complete' + full score payload

const ALLOWED_ORIGINS = [
  'https://eatcrayons.com',
  'https://www.eatcrayons.com',
  'https://eatcrayonshome.vercel.app',
];

const EVENT_TYPES = new Set(['start', 'abandon', 'complete']);
const UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIERS     = new Set(['exceptional', 'strong', 'nomatch']);

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
      // Extract visitor environment from headers (server-side, never from client)
      const ip         = firstIp(req.headers['x-forwarded-for']);
      const userAgent  = sstr(req.headers['user-agent'], 500);
      const geoCountry = sstr(req.headers['x-vercel-ip-country'], 8);
      const geoRegion  = sstr(req.headers['x-vercel-ip-country-region'], 16);
      const geoCity    = sstr(decodeHeader(req.headers['x-vercel-ip-city']), 120);

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

    const patch = {
      status:          'complete',
      completed_at:    new Date().toISOString(),
      score_pct:       scorePct,
      score_tier:      scoreTier,
      flags:           flags,
      answers:         answers,
      revenue_label:   sstr(body.revenue_label,   200),
      business_model:  sstr(body.business_model,  100),
      deal_size_label: sstr(body.deal_size_label, 200),
      budget_label:    sstr(body.budget_label,    200),
      marketing_state: sstr(body.marketing_state, 200),
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
