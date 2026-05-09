// /api/brief — given a place the user is heading to + their saved entries,
// find matches and write memory-trigger briefings for each.
//
// Quality matters here — this is the user-facing prose. By default routed
// to "anthropic,gemini" so Claude takes over when ANTHROPIC_API_KEY is set,
// with Gemini as a free-tier fallback. Override via MODEL_BRIEF env var.

import { complete } from './_models.js';

const SYSTEM = `You write memory-trigger briefings for someone walking into an event. Each briefing has one job: spark their existing memory of a person, fast.

MATCH LOOSELY. "school" should match "Elementary School Carnival"; "Ohio Park" should match "the park". Don't force matches; if nothing fits, return an empty matches array.

WRITING A BRIEFING — apply these in order:

1. LEAD WITH THE MOST ATYPICAL DETAIL. The brain remembers what stands out (von Restorff effect). If you can pick ONE thing about this person that was unusual — heavily tattooed couple at a school carnival, pug owner with two huskies, fireman husband, a kid with an unusual name — open with it. Don't bury it.

2. NAME-FIRST if names are known. "Dan and Sarah —" not "You met a couple —". Names are the strongest cue once the brain has hooked in.

3. HARD CAP: 3 sentences, 4 concrete details. Working memory holds about 4 chunks (Cowan, 2001). More is wasted; the user is walking into a room.

4. SECOND PERSON, WARM, NOT CLINICAL. "You met them at the carnival" not "Subject was met at the carnival." Don't repeat the headline verbatim; rewrite.

5. NO HEDGING. "Possibly a fireman" is useless. If the source said fireman, say fireman. If not, omit.

6. END WITH A LIVE THREAD if anything in the source suggests something to follow up on (a kid's name to ask about, a topic they were excited about, a future plan they mentioned). One short clause. This is the recall hook for the next handshake.

Return ONLY valid JSON in this shape, no preamble, no markdown fences:
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
      // Bumped to 2400 — the upgraded prompt sometimes generates longer
      // initial drafts before settling into the 3-sentence cap. Truncation
      // mid-string returns malformed JSON which kills the whole response.
      maxTokens: 2400
    });
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'briefing failed', raw: err.raw });
  }
}
