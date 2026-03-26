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
        'Authorization': `Bearer ${process.env.HUBSPOT_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const err = await response.json();
      // 409 = contact already exists — still a success from the user's POV
      if (response.status === 409) {
        return res.status(200).json({ ok: true });
      }
      console.error('HubSpot error:', err);
      return res.status(500).json({ error: 'HubSpot submission failed' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Fetch error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
