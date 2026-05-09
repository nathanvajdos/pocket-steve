// Vercel serverless function — turns a raw voice/text dump into structured data.
// Steve says: "Met a couple at the school carnival, dog Otis, kid Malachi..."
// We return: { headline, summary, names, kids, pets, traits, where }
//
// Calls Gemini 2.5 Flash via the Google AI REST API. No SDK needed.

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { text, where } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const systemInstruction = `You extract structured details from a person's quick voice memo about people they just met.

Return ONLY valid JSON matching this exact shape, no preamble:
{
  "headline": "Short label (e.g. 'Couple from California with kid Malachi'). 8 words max.",
  "summary": "2-3 sentence summary written in second person, like reminding the user later. Include names, relationships, distinctive traits, kids, pets, anything memorable.",
  "names": ["any explicit names mentioned, or empty array"],
  "kids": ["kids' names mentioned"],
  "pets": ["pets mentioned, formatted as 'Otis (dog)'"],
  "traits": ["distinctive observations, e.g. 'heavily tattooed', 'alternative aesthetic', 'works at Nationwide'"],
  "where": "Where they met, inferred if not stated explicitly. Short phrase."
}

If a field has no info, use an empty string or empty array. Never invent details. Be terse.`;

  const userPrompt = `Voice memo: "${text}"\n\nUser-provided "where" (may be empty): "${where || ''}"\n\nReturn the JSON now.`;

  try {
    const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 800,
          responseMimeType: 'application/json'
        }
      })
    });

    if (!r.ok) {
      const errText = await r.text();
      return res.status(502).json({ error: 'Gemini call failed', detail: errText });
    }

    const data = await r.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return res.status(502).json({ error: 'Model returned non-JSON', raw }); }

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'extraction failed' });
  }
}
