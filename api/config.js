// /api/config
//
// Exposes the Supabase URL + anon key to the frontend. Both are public
// (the anon key is designed to be shipped in browser code) — we just
// don't want them hardcoded in app.js so deploys can change them via env vars.

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || ''
  });
}
