const ALLOWED_ORIGINS = [
  'https://eatcrayons.com',
  'https://www.eatcrayons.com',
  'https://eatcrayonshome.vercel.app',
];

const PORTAL_ID = '8976131';
const FORM_GUID = '87ad73fa-b7a9-41b7-a759-43166b5f30b0';

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

// Strip HTML tags and null bytes from a string
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').replace(/\0/g, '').trim();
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max) : str;
}

export default async function handler(req, res) {
  // CORS — only accept requests from known origins
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
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Reject oversized bodies (belt-and-suspenders; Vercel caps at 4.5MB but we want tighter)
  const contentLength = parseInt(req.headers['content-length'] || '0', 10);
  if (contentLength > 20_000) return res.status(413).json({ error: 'Payload too large' });

  const body = req.body || {};
  if (typeof body !== 'object' || Array.isArray(body)) {
    return res.status(400).json({ error: 'Invalid request body' });
  }

  // Sanitize and validate inputs
  const name     = truncate(sanitize(body.name),     100);
  const email    = truncate(sanitize(body.email),    254);
  const company  = truncate(sanitize(body.company),  200);
  const services = truncate(sanitize(body.services), 500);
  const message  = truncate(sanitize(body.message),  5000);

  if (!name)  return res.status(400).json({ error: 'Name is required' });
  if (!email) return res.status(400).json({ error: 'Email is required' });
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'Invalid email address' });

  const nameParts = name.split(' ');
  const firstname = nameParts[0];
  const lastname  = nameParts.slice(1).join(' ') || '';

  // Build optional quiz block from localStorage data passed by the client
  const rawQuiz = (body.quiz && typeof body.quiz === 'object' && !Array.isArray(body.quiz)) ? body.quiz : null;
  let quizBlock = '';
  if (rawQuiz) {
    const scorePct  = parseInt(rawQuiz.score_pct, 10);
    const tier      = sanitize(String(rawQuiz.score_tier   || ''));
    const revenue   = truncate(sanitize(String(rawQuiz.revenue_label   || '')), 100);
    const model     = truncate(sanitize(String(rawQuiz.business_model  || '')), 100);
    const dealSize  = truncate(sanitize(String(rawQuiz.deal_size_label || '')), 100);
    const budget    = truncate(sanitize(String(rawQuiz.budget_label    || '')), 100);
    const flags     = truncate(sanitize(String(rawQuiz.flags           || '')), 200);
    const marketing = truncate(sanitize(String(rawQuiz.marketing_state || '')), 200);
    const takenMs   = parseInt(rawQuiz.quiz_taken_at, 10);
    const takenAt   = !isNaN(takenMs)
      ? new Date(takenMs).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
      : '';
    const tierLabel = tier === 'exceptional' ? 'Exceptional Match'
                    : tier === 'strong'       ? 'Strong Potential'
                    : tier === 'nomatch'      ? 'Not the Right Fit Yet' : '';
    const scoreStr  = !isNaN(scorePct) ? `${scorePct}%` : '';

    quizBlock = [
      '[Growth Matchmaker]',
      [scoreStr, tierLabel].filter(Boolean).join(' -- '),
      revenue   ? `Revenue: ${revenue}`     : '',
      model     ? `Model: ${model}`         : '',
      dealSize  ? `Deal Size: ${dealSize}`  : '',
      budget    ? `Budget: ${budget}`       : '',
      marketing ? `Marketing: ${marketing}` : '',
      flags     ? `Flags: ${flags}`         : 'Flags: none',
      takenAt   ? `Taken: ${takenAt}`       : '',
    ].filter(Boolean).join('\n');
  }

  const fullMessage = [
    services  ? `Interested in: ${services}` : '',
    message   || '',
    quizBlock || '',
  ].filter(Boolean).join('\n\n');

  const fields = [
    { name: 'firstname', value: firstname },
    { name: 'lastname',  value: lastname },
    { name: 'email',     value: email },
    { name: 'company',   value: company },
    { name: 'message',   value: fullMessage },
  ];

  // Optional custom HubSpot properties -- no-ops until created in HubSpot settings.
  // Once created (matchmaker_score, matchmaker_tier, matchmaker_flags), data flows automatically.
  if (rawQuiz) {
    const scorePctVal = parseInt(rawQuiz.score_pct, 10);
    const tierVal     = sanitize(String(rawQuiz.score_tier || ''));
    const flagsVal    = truncate(sanitize(String(rawQuiz.flags || '')), 200);
    if (!isNaN(scorePctVal)) fields.push({ name: 'matchmaker_score', value: String(scorePctVal) });
    if (tierVal)             fields.push({ name: 'matchmaker_tier',  value: tierVal });
    if (flagsVal)            fields.push({ name: 'matchmaker_flags', value: flagsVal });
  }

  const payload = {
    fields,
    context: {
      pageUri: 'https://eatcrayons.com/contact',
      pageName: 'Contact',
    },
  };

  try {
    const response = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${PORTAL_ID}/${FORM_GUID}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }
    );

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      console.error('HubSpot error:', response.status, JSON.stringify(data));
      return res.status(502).json({ error: 'Submission failed. Please try again.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Fetch error:', err.message);
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
}
