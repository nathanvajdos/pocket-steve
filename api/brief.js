// /api/brief — given a place the user is heading to + their saved entries,
// find matches and write memory-trigger briefings for each.
//
// Quality matters here — this is the user-facing prose. By default routed
// to "anthropic,gemini" so Claude takes over when ANTHROPIC_API_KEY is set,
// with Gemini as a free-tier fallback. Override via MODEL_BRIEF env var.

import { complete } from './_models.js';

const SYSTEM = `You help someone remember people they've met. Given a place they're heading to and a list of past meetings, find the relevant ones and write a short memory-trigger briefing for each match.

Match loosely — "school" should match "Elementary School Carnival", "Ohio Park" should match "the park". Don't force matches; if nothing fits, return empty matches.

Each briefing is 2-3 sentences in second person ("You met..."), warm and specific. Lead with names if known. Hit the distinctive details first — kids, pets, traits — because those are what trigger memory. Don't repeat the headline verbatim; rewrite for warmth.

Return ONLY valid JSON matching this shape, no preamble:
{
  "matches": [
    { "id": "<entry id>", "briefing": "Short memory-trigger paragraph." }
  ]
}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { where, entries } = req.body || {};
  if (!where || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'where and entries required' });
  }

  const compact = entries.map(e => ({
    id: e.id,
    where: e.where || e.where_met || '',
    headline: e.headline || '',
    summary: e.summary || '',
    raw: e.raw || '',
    when: e.createdAt || e.created_at || ''
  }));

  const userPrompt = `Heading to: "${where}"\n\nPast meetings:\n${JSON.stringify(compact, null, 2)}\n\nReturn the JSON now.`;

  try {
    const parsed = await complete({
      task: 'brief',
      system: SYSTEM,
      user: userPrompt,
      json: true,
      temperature: 0.4,
      maxTokens: 1500
    });
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'briefing failed', raw: err.raw });
  }
}
