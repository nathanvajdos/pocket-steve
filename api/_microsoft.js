// Microsoft Graph helper.
// - Stores/refreshes OAuth tokens via the service-role Supabase client.
// - Lists upcoming calendar events for a connected user.

import { serviceClient } from './_supabase.js';

const TOKEN_URL = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
const AUTHORIZE_URL = (tenant) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;

const SCOPE = 'openid profile email offline_access Calendars.Read';

export function getMicrosoftConfig() {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  const tenant = process.env.MICROSOFT_TENANT_ID || 'common';
  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth not configured (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET missing)');
  }
  return { clientId, clientSecret, tenant };
}

export function buildAuthorizeUrl({ state, redirectUri }) {
  const { clientId, tenant } = getMicrosoftConfig();
  const url = new URL(AUTHORIZE_URL(tenant));
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  return url.toString();
}

export async function exchangeCodeForTokens({ code, redirectUri }) {
  const { clientId, clientSecret, tenant } = getMicrosoftConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
    scope: SCOPE
  });
  const r = await fetch(TOKEN_URL(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!r.ok) throw new Error('Microsoft token exchange failed: ' + (await r.text()));
  return r.json();
}

async function refreshAccessToken(refreshToken) {
  const { clientId, clientSecret, tenant } = getMicrosoftConfig();
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
    scope: SCOPE
  });
  const r = await fetch(TOKEN_URL(tenant), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!r.ok) throw new Error('Microsoft refresh failed: ' + (await r.text()));
  return r.json();
}

export async function saveTokens({ userId, tokens, accountEmail, accountId }) {
  const supa = serviceClient();
  const expiresAt = new Date(Date.now() + (tokens.expires_in - 60) * 1000).toISOString();
  const row = {
    user_id: userId,
    provider: 'microsoft',
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || null,
    expires_at: expiresAt,
    scope: tokens.scope || SCOPE,
    account_email: accountEmail || null,
    account_id: accountId || null
  };
  const { error } = await supa
    .from('oauth_tokens')
    .upsert(row, { onConflict: 'user_id,provider' });
  if (error) throw error;
}

export async function getConnection(userId) {
  const supa = serviceClient();
  const { data, error } = await supa
    .from('oauth_tokens')
    .select('*')
    .eq('user_id', userId)
    .eq('provider', 'microsoft')
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function disconnect(userId) {
  const supa = serviceClient();
  const { error } = await supa
    .from('oauth_tokens')
    .delete()
    .eq('user_id', userId)
    .eq('provider', 'microsoft');
  if (error) throw error;
}

// Returns a valid access token, refreshing if expired. Persists the new
// access token if a refresh happened.
export async function getValidAccessToken(userId) {
  const conn = await getConnection(userId);
  if (!conn) return null;

  const expired = new Date(conn.expires_at).getTime() < Date.now() + 30_000; // 30s buffer
  if (!expired) return conn.access_token;
  if (!conn.refresh_token) return null;

  const refreshed = await refreshAccessToken(conn.refresh_token);
  await saveTokens({
    userId,
    tokens: {
      access_token: refreshed.access_token,
      refresh_token: refreshed.refresh_token || conn.refresh_token,
      expires_in: refreshed.expires_in,
      scope: refreshed.scope
    },
    accountEmail: conn.account_email,
    accountId: conn.account_id
  });
  return refreshed.access_token;
}

// Fetches user profile from Graph (used at connect time to record their email).
export async function fetchProfile(accessToken) {
  const r = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName,displayName', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!r.ok) throw new Error('Graph /me failed: ' + (await r.text()));
  return r.json();
}

// Fetches calendar events between two ISO datetimes via Graph calendarView.
// calendarView expands recurrence, which is exactly what we want for nudges.
export async function fetchEventsInWindow({ accessToken, startISO, endISO }) {
  const url = new URL('https://graph.microsoft.com/v1.0/me/calendarview');
  url.searchParams.set('startDateTime', startISO);
  url.searchParams.set('endDateTime', endISO);
  url.searchParams.set('$select', 'id,subject,location,start,end,bodyPreview');
  url.searchParams.set('$top', '50');
  url.searchParams.set('$orderby', 'start/dateTime');

  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: 'outlook.timezone="UTC"'
    }
  });
  if (!r.ok) throw new Error('Graph calendarView failed: ' + (await r.text()));
  const data = await r.json();
  // Normalize to the same shape parseIcs uses
  return (data.value || []).map(e => ({
    uid: e.id,
    summary: e.subject || '',
    location: e.location?.displayName || '',
    description: e.bodyPreview || '',
    startsAt: e.start?.dateTime ? `${e.start.dateTime}Z`.replace('ZZ', 'Z') : null,
    endsAt: e.end?.dateTime ? `${e.end.dateTime}Z`.replace('ZZ', 'Z') : null
  }));
}
