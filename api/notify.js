// /api/notify
//
// One-way push channel: lets the iteration-loop CLI deliver a Steve.ai
// status email to Nathan without him having to go check the repo,
// the deploy log, or anything else. Hardcoded recipient (Nathan only)
// + CRON_SECRET-auth so a leaked secret can't be turned into a spam
// vector against arbitrary addresses.
//
// Usage:
//   curl -X POST https://memory-trigger.vercel.app/api/notify \
//     -H "Authorization: Bearer $CRON_SECRET" \
//     -H "Content-Type: application/json" \
//     -d '{"subject":"Steve.ai v1.7.14 live","body":"plain-text body"}'
//
// Twilio SMS to Nathan is dead until the trial Twilio account upgrades
// (error 30032 on the toll-free path). Email-via-Resend works today
// because RESEND_API_KEY + RESEND_FROM_EMAIL are already set in Vercel
// (calendar-scan uses them), so this endpoint adds zero env-var debt.

import { sendEmail } from './_email.js';

const RECIPIENT = 'Nathan.Vajdos@regis-energy.com';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = req.headers.authorization || '';
  const expected = process.env.CRON_SECRET;
  if (!expected) return res.status(500).json({ error: 'CRON_SECRET not configured' });
  if (auth !== `Bearer ${expected}`) return res.status(401).json({ error: 'unauthorized' });

  const { subject, body } = req.body || {};
  if (!subject || typeof subject !== 'string') {
    return res.status(400).json({ error: 'subject required' });
  }
  if (!body || typeof body !== 'string') {
    return res.status(400).json({ error: 'body required' });
  }

  // Wrap plain-text body in minimal HTML so mail clients render line breaks
  // cleanly and links auto-linkify. The plain-text version is also passed
  // for clients that prefer it.
  const html = `<pre style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap;margin:0;color:#1a1a1c;">${escapeHtml(body)}</pre>`;

  try {
    const result = await sendEmail({
      to: RECIPIENT,
      subject,
      html,
      text: body
    });
    return res.status(200).json({ ok: true, id: result?.id || null, to: RECIPIENT });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'send failed' });
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}
