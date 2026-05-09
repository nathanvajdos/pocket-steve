// /api/oauth/microsoft  — combined start / callback / disconnect router.
//
// (Combined into a single file to fit Vercel Hobby plan's 12-function ceiling.)
//
// GET  /api/oauth/microsoft?action=start            — authenticated user; returns { authorizeUrl }
// GET  /api/oauth/microsoft?code=...&state=...      — Microsoft redirects here after consent
// POST /api/oauth/microsoft?action=disconnect       — authenticated user; revokes tokens
//
// Microsoft Azure App Registration's redirect URI must be:
//   https://<host>/api/oauth/microsoft

import crypto from 'crypto';
import { requireUser } from '../_supabase.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchProfile,
  saveTokens,
  disconnect
} from '../_microsoft.js';

function signState(userId) {
  const secret = process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET || 'dev-secret';
  const payload = JSON.stringify({ userId, ts: Date.now() });
  const b64 = Buffer.from(payload).toString('base64url');
  const hmac = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  return `${b64}.${hmac}`;
}

function verifyState(state) {
  if (!state || !state.includes('.')) return null;
  const [b64, sig] = state.split('.');
  const secret = process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET || 'dev-secret';
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    const { userId, ts } = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!userId || !ts) return null;
    if (Date.now() - ts > 10 * 60 * 1000) return null; // 10-min TTL
    return userId;
  } catch { return null; }
}

function originFromReq(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  return `${proto}://${host}`;
}

function redirectTo(res, target) {
  res.statusCode = 302;
  res.setHeader('Location', target);
  res.end();
}

export default async function handler(req, res) {
  const action = req.query?.action;
  const hasCode = !!req.query?.code;
  const origin = originFromReq(req);
  const redirectUri = `${origin}/api/oauth/microsoft`;

  // ---- callback (Microsoft redirects here with ?code=... after consent) ----
  if (hasCode || req.query?.error) {
    const { code, state, error: oauthError, error_description } = req.query;
    if (oauthError) {
      return redirectTo(res, `${origin}/?oauthError=${encodeURIComponent(error_description || oauthError)}#settings`);
    }
    const userId = verifyState(state);
    if (!userId || !code) {
      return redirectTo(res, `${origin}/?oauthError=${encodeURIComponent('Invalid state — try connecting again')}#settings`);
    }
    try {
      const tokens = await exchangeCodeForTokens({ code, redirectUri });
      const profile = await fetchProfile(tokens.access_token);
      await saveTokens({
        userId,
        tokens,
        accountEmail: profile.mail || profile.userPrincipalName || null,
        accountId: profile.id || null
      });
      return redirectTo(res, `${origin}/?oauthConnected=microsoft#settings`);
    } catch (err) {
      return redirectTo(res, `${origin}/?oauthError=${encodeURIComponent(err.message || 'Unknown error')}#settings`);
    }
  }

  // ---- start (authenticated) ----
  if (action === 'start') {
    const auth = await requireUser(req, res);
    if (!auth) return;
    try {
      const state = signState(auth.user.id);
      const url = buildAuthorizeUrl({ state, redirectUri });
      return res.status(200).json({ authorizeUrl: url });
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Could not start OAuth' });
    }
  }

  // ---- disconnect (authenticated) ----
  if (action === 'disconnect') {
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

  return res.status(400).json({ error: 'Specify ?action=start or ?action=disconnect, or hit this URL with a Microsoft callback code.' });
}
