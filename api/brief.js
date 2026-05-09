// Vercel serverless function — given a place Steve is heading to and his saved
// entries, find the matches and write a memory-trigger briefing for each.
// Important: entries are sent from the client per-request. We never persist them.
//
// Calls Gemini 2.5 Flash via the Google AI REST API. No SDK needed.

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { where, entries } = req.body || {};
  if (!where || !Array.isArray(entries)) {
    return res.status(400).json({ error: 'where and entries required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  // Trim entries to a manageable shape — we don't want to ship bloat to the model.
  const compact = entries.map(e => ({
    id: e.id,
    where: e.where || '',
    headline: e.headline || '',
    summary: e.summary || '',
    raw: e.raw || '',
    when: e.createdAt || ''
  }));

  const systemInstruction = `You help someone remember people they've met. Given a place they're heading to and a list of past meetings, find the relevant ones and write a short memory-trigger briefing for each match.

Match loosely — "school" should match "Elementary School Carnival", "Ohio Park" should match "the park". Don't force matches; if nothing fits, return empty matches.

Each briefing is 2-3 sentences in second person ("You met..."), warm and specific. Lead with names if known. Hit the distinctive details first — kids, pets, traits — because those are what trigger memory.

Return ONLY valid JSON matching this shape, no preamble:
{
  "matches": [
    { "id": "<entry id>", "briefing": "Short memory-trigger paragraph." }
  ]
}`;

  const userPrompt = `Heading to: "${where}"\n\nPast meetings:\n${JSON.stringify(compact, null, 2)}\n\nReturn the JSON now.`;

  try {
    const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 1500,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: 'Gemini call failed', detail: errText });
    }

    const data = await r.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{"matches":[]}';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return res.status(502).json({ error: 'Model returned non-JSON', raw }); }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'briefing failed' });
  }
}
