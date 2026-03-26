export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, company, services, message } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const nameParts = name.trim().split(' ');
  const firstname = nameParts[0];
  const lastname  = nameParts.slice(1).join(' ') || '';

  const fullMessage = [
    services ? `Interested in: ${services}` : '',
    message  ? message : '',
  ].filter(Boolean).join('\n\n');

  const portalId = '8976131';
  const formGuid = '87ad73fa-b7a9-41b7-a759-43166b5f30b0';

  const payload = {
    fields: [
      { name: 'firstname', value: firstname },
      { name: 'lastname',  value: lastname },
      { name: 'email',     value: email },
      { name: 'company',   value: company || '' },
      { name: 'message',   value: fullMessage },
    ],
    context: {
      pageUri: 'https://eatcrayonshome.com/contact',
      pageName: 'Contact',
    },
  };

  try {
    const response = await fetch(
      `https://api.hsforms.com/submissions/v3/integration/submit/${portalId}/${formGuid}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.error('HubSpot form error status:', response.status);
      console.error('HubSpot form error body:', JSON.stringify(data));
      return res.status(500).json({ error: 'HubSpot submission failed', detail: data });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Fetch error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
