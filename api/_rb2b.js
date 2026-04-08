// RB2B API helper — server-side only.
//
// Docs: https://www.rb2b.com/apis  (Postman: https://postman.api.rb2b.com)
//
// Endpoints used:
//   POST /api/v1/ip_to_hem           — IP (+UA) → [{ md5, sha256, score }, ...]
//   POST /api/v1/hem_to_best_linkedin — MD5 HEM → { linkedin_url }
//
// Both calls are rate-limited (50 req/s per endpoint per account), billed
// per 200 response only (404 is free), and use `Api-Key: <key>` auth.
//
// Env: RB2B_API_KEY  (set in Vercel → Environment Variables)
//
// All functions are fail-safe: they return null on any error (network,
// timeout, 4xx/5xx, malformed response) and never throw. The caller must
// treat null as "unknown" and proceed without enrichment.

const BASE_URL = 'https://api.rb2b.com/api/v1';
const TIMEOUT_MS = 4000;

async function postJson(path, body) {
  const apiKey = process.env.RB2B_API_KEY;
  if (!apiKey) {
    console.error('rb2b: RB2B_API_KEY env var not set');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Api-Key':      apiKey,
        'Content-Type': 'application/json',
      },
      body:   JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // 404 = no data for lookup key (free, not an error from our POV)
    if (response.status === 404) return { __noData: true };

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`rb2b: ${path} http ${response.status}`, text.slice(0, 200));
      return null;
    }

    const data = await response.json().catch(() => null);
    if (!data) {
      console.error(`rb2b: ${path} returned invalid JSON`);
      return null;
    }
    return data;
  } catch (err) {
    clearTimeout(timeout);
    console.error(`rb2b: ${path} fetch error`, err && err.message ? err.message : err);
    return null;
  }
}

// Resolve an IP (+ optional user agent) to the highest-confidence MD5 hashed
// email. Returns { md5: string, score: number } on success, or null if no
// match / call failed.
export async function ipToBestHem(ip, userAgent) {
  if (!ip) return null;

  const body = { ip_address: ip };
  if (userAgent) body.user_agent = userAgent;

  const data = await postJson('/ip_to_hem', body);
  if (!data || data.__noData) return null;

  const results = Array.isArray(data.results) ? data.results : [];
  if (results.length === 0) return null;

  // Pick the highest-score result with a valid MD5
  let best = null;
  for (const r of results) {
    if (!r || typeof r.md5 !== 'string' || r.md5.length !== 32) continue;
    const score = typeof r.score === 'number' ? r.score : 0;
    if (!best || score > best.score) {
      best = { md5: r.md5.toLowerCase(), score };
    }
  }
  return best;
}

// Resolve an MD5 hashed email to the best LinkedIn URL. Returns the URL
// string on success, or null if no match / call failed.
export async function hemToLinkedInUrl(md5) {
  if (typeof md5 !== 'string' || md5.length !== 32) return null;

  const data = await postJson('/hem_to_best_linkedin', { md5 });
  if (!data || data.__noData) return null;

  const url = data.results && typeof data.results.linkedin_url === 'string'
    ? data.results.linkedin_url.trim()
    : '';

  // Sanity check: must look like a LinkedIn profile URL
  if (!url || !/^https?:\/\/([a-z]+\.)?linkedin\.com\//i.test(url)) return null;
  return url;
}
