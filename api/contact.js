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

  const fullMessage = [
    services ? `Interested in: ${services}` : '',
    message  || '',
  ].filter(Boolean).join('\n\n');

  const payload = {
    fields: [
      { name: 'firstname', value: firstname },
      { name: 'lastname',  value: lastname },
      { name: 'email',     value: email },
      { name: 'company',   value: company },
      { name: 'message',   value: fullMessage },
    ],
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
