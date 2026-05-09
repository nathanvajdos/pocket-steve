// Supabase client helpers used across serverless functions.
//
// We avoid stateful sessions on the server. The frontend holds the user's
// access token (from Supabase Auth magic-link login) and sends it as a
// Bearer token. We instantiate a per-request client that respects RLS as
// that user.
//
// For the daily cron we use the service-role client, which bypasses RLS.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL) console.warn('[supabase] SUPABASE_URL not set');

export function userClient(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export function serviceClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY not set — required for cron jobs');
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export async function requireUser(req, res) {
  const supa = userClient(req);
  const { data: { user }, error } = await supa.auth.getUser();
  if (error || !user) {
    res.status(401).json({ error: 'Not authenticated' });
    return null;
  }
  return { user, supa };
}
