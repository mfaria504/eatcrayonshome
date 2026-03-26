export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { name, email, company, services, message } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  const apiKey = process.env.HUBSPOT_API_KEY;
  if (!apiKey) {
    console.error('HUBSPOT_API_KEY is not set');
    return res.status(500).json({ error: 'Server misconfiguration' });
  }

  const nameParts = name.trim().split(' ');
  const firstname = nameParts[0];
  const lastname  = nameParts.slice(1).join(' ') || '';

  const fullMessage = [
    services ? `Interested in: ${services}` : '',
    message  ? message : '',
  ].filter(Boolean).join('\n\n');

  const payload = {
    properties: {
      firstname,
      lastname,
      email,
      company:  company || '',
      message:  fullMessage,
    },
  };

  try {
    const response = await fetch('https://api.hubapi.com/crm/v3/objects/contacts', {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      // 409 = contact already exists — treat as success
      if (response.status === 409) {
        return res.status(200).json({ ok: true });
      }
      console.error('HubSpot error status:', response.status);
      console.error('HubSpot error body:', JSON.stringify(data));
      return res.status(500).json({ error: 'HubSpot submission failed', detail: data });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Fetch error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}
