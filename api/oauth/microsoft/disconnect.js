// /api/oauth/microsoft/disconnect
// Authenticated user can revoke the calendar connection.

import { requireUser } from '../../_supabase.js';
import { disconnect } from '../../_microsoft.js';

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await requireUser(req, res);
  if (!auth) return;
  try {
    await disconnect(auth.user.id);
    return res.status(200).json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Disconnect failed' });
  }
}
