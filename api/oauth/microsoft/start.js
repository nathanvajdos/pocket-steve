// /api/oauth/microsoft/start
//
// Frontend calls this with the user's auth header. We mint a signed state
// (containing user_id) and return the Microsoft authorize URL so the
// frontend can window.location-redirect to it.

import { requireUser } from '../../_supabase.js';
import { buildAuthorizeUrl } from '../../_microsoft.js';
import crypto from 'crypto';

function signState(userId) {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET || 'dev-secret';
  const payload = JSON.stringify({ userId, ts: Date.now() });
  const b64 = Buffer.from(payload).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${hmac}`;
}

export default async function handler(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user } = auth;

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const redirectUri = `${proto}://${host}/api/oauth/microsoft/callback`;

  try {
    const state = signState(user.id);
    const url = buildAuthorizeUrl({ state, redirectUri });
    return res.status(200).json({ authorizeUrl: url });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Could not start OAuth' });
  }
}
