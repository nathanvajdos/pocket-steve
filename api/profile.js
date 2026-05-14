// /api/profile
//
// GET  -> returns { profile: { calendar_ics_url, ... } | null }
// PUT  -> upserts the user's profile { calendar_ics_url }
//
// Microsoft OAuth path removed in v1.7.19. The Outlook check + `microsoft` return
// field are gone; the only calendar integration is the user-pasted .ics URL.

import { requireUser } from './_supabase.js';

export default async function handler(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supa } = auth;

  try {
    if (req.method === 'GET') {
      const { data: profile, error } = await supa
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return res.status(200).json({ profile: profile || null });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      // Apple Calendar gives back webcal:// URLs from "Share Link" — same
      // content as https, just Apple's "open in Calendar.app" protocol.
      // Normalize on save so the cron + every downstream read sees https.
      const rawUrl = body.calendar_ics_url ?? null;
      const url = rawUrl ? rawUrl.replace(/^webcal:\/\//i, 'https://') : null;
      const row = {
        user_id: user.id,
        email: user.email,
        calendar_ics_url: url
      };
      const { data, error } = await supa
        .from('profiles')
        .upsert(row, { onConflict: 'user_id' })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ profile: data });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'profile failed' });
  }
}
