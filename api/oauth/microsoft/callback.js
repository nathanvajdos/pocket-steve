// /api/oauth/microsoft/callback
//
// Microsoft redirects the user here after they approve. We verify the state,
// exchange the code for tokens, fetch their profile, persist tokens, and
// redirect them back to /settings with a success flag.

import { exchangeCodeForTokens, fetchProfile, saveTokens } from '../../_microsoft.js';
import crypto from 'crypto';

function verifyState(state) {
  if (!state || !state.includes('.')) return null;
  const [b64, sig] = state.split('.');
  const secret = process.env.OAUTH_STATE_SECRET || process.env.CRON_SECRET || 'dev-secret';
  const expected = crypto.createHmac('sha256', secret).update(b64).digest('base64url');
  if (sig !== expected) return null;
  try {
    const { userId, ts } = JSON.parse(Buffer.from(b64, 'base64url').toString('utf8'));
    if (!userId || !ts) return null;
    if (Date.now() - ts > 10 * 60 * 1000) return null; // 10-min state TTL
    return userId;
  } catch { return null; }
}

function redirectWith(res, target) {
  res.statusCode = 302;
  res.setHeader('Location', target);
  res.end();
}

export default async function handler(req, res) {
  const { code, state, error: oauthError, error_description } = req.query;

  const proto = req.headers['x-forwarded-proto'] || 'https';
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const origin = `${proto}://${host}`;

  if (oauthError) {
    return redirectWith(res, `${origin}/?oauthError=${encodeURIComponent(error_description || oauthError)}#settings`);
  }

  const userId = verifyState(state);
  if (!userId || !code) {
    return redirectWith(res, `${origin}/?oauthError=${encodeURIComponent('Invalid state — try connecting again')}#settings`);
  }

  try {
    const redirectUri = `${origin}/api/oauth/microsoft/callback`;
    const tokens = await exchangeCodeForTokens({ code, redirectUri });
    const profile = await fetchProfile(tokens.access_token);
    await saveTokens({
      userId,
      tokens,
      accountEmail: profile.mail || profile.userPrincipalName || null,
      accountId: profile.id || null
    });
    return redirectWith(res, `${origin}/?oauthConnected=microsoft#settings`);
  } catch (err) {
    return redirectWith(res, `${origin}/?oauthError=${encodeURIComponent(err.message || 'Unknown error')}#settings`);
  }
}
