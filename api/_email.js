// Send email via Resend.
// Requires RESEND_API_KEY and RESEND_FROM_EMAIL env vars.

const RESEND_API_URL = 'https://api.resend.com/emails';

export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL || 'Steve <onboarding@resend.dev>';
  if (!apiKey) throw new Error('RESEND_API_KEY not set');

  const r = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ from, to, subject, html, text })
  });
  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`Resend ${r.status}: ${detail}`);
  }
  return r.json();
}
