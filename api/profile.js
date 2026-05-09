// /api/profile
//
// GET  -> returns the user's profile (calendar_ics_url, microsoft_connected boolean)
// PUT  -> upserts the user's profile { calendar_ics_url }

import { requireUser, serviceClient } from './_supabase.js';

async function checkMicrosoftConnected(userId) {
  try {
    const supa = serviceClient();
    const { data } = await supa
      .from('oauth_tokens')
      .select('user_id, account_email')
      .eq('user_id', userId)
      .eq('provider', 'microsoft')
      .maybeSingle();
    return data ? { email: data.account_email } : null;
  } catch {
    return null;
  }
}

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
      const ms = await checkMicrosoftConnected(user.id);
      return res.status(200).json({
        profile: profile || null,
        microsoft: ms          // null when not connected, { email } when connected
      });
    }

    if (req.method === 'PUT') {
      const body = req.body || {};
      const row = {
        user_id: user.id,
        email: user.email,
        calendar_ics_url: body.calendar_ics_url ?? null
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
