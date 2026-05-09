// /api/invite
//
// Authenticated user generates a one-tap sign-in link for a friend.
// The server uses the Supabase admin API to produce a magic-link URL,
// then returns it to the frontend with a suggested subject + plaintext body.
// The frontend opens the user's own mail app via `mailto:` with everything
// prefilled — they review and hit Send. The recipient gets a personal email
// from a person they recognize, with a one-tap sign-in button.
//
// (We could also automate via Resend, but Resend free tier requires domain
// verification to deliver to anyone but the account holder, and a personal
// email feels better for inviting friends anyway.)

import { requireUser, serviceClient } from './_supabase.js';

const BASE_URL = 'https://memory-trigger.vercel.app';

function friendlyInviter(inviter) {
  const name = inviter.user_metadata?.full_name || inviter.user_metadata?.name;
  if (name) return name;
  if (inviter.email) return inviter.email.split('@')[0];
  return 'A friend';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const inviter = auth.user;

  // The UI is email-only. We accept (and ignore) `name`/`message` from any
  // stale cached clients — the personal note now happens in the user's mail
  // app, where they edit the prefilled body before sending.
  const { email } = req.body || {};
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email required' });
  }
  const cleanEmail = email.trim().toLowerCase();
  if (!/.+@.+\..+/.test(cleanEmail)) {
    return res.status(400).json({ error: 'invalid email format' });
  }

  try {
    const supa = serviceClient();

    const { data, error } = await supa.auth.admin.generateLink({
      type: 'magiclink',
      email: cleanEmail,
      options: { redirectTo: BASE_URL }
    });
    if (error) throw error;
    const actionLink = data?.properties?.action_link;
    if (!actionLink) throw new Error('No action link returned by Supabase');

    const inviterName = friendlyInviter(inviter);
    const recipientFirstName = cleanEmail.split('@')[0];

    const subject = `${inviterName} invited you to Steve`;
    const body = buildPlainTextBody({
      inviterName,
      recipientFirstName,
      actionLink
    });

    return res.status(200).json({
      ok: true,
      recipientEmail: cleanEmail,
      subject,
      body,
      actionLink
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'invite failed' });
  }
}

function buildPlainTextBody({ inviterName, recipientFirstName, actionLink }) {
  return `Hi ${recipientFirstName},

Try Steve — a little memory app for the people you meet.

Open this email on your iPhone and tap the link below to sign in instantly (no password):

${actionLink}

Once it opens in Safari, tap Share → Add to Home Screen to make it a real app icon.

Then tap "+ Just met someone" and just talk — the app remembers everyone you meet so you can be the person who actually remembers names, kids, pets, and details next time you bump into them.

— ${inviterName}

(Link works for one hour. If you miss the window, ping me for a new one.)`;
}
