// /api/extract — voice/text dump → structured fields.
// Routed via _models.js so the underlying provider can be swapped per-task
// via env vars (see _models.js docstring). Default is Gemini 2.5 Flash.

import { complete } from './_models.js';

const SYSTEM = `You extract structured details from a person's quick voice memo about people they just met.

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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { text, where } = req.body || {};
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'text required' });
  }

  const userPrompt = `Voice memo: "${text}"\n\nUser-provided "where" (may be empty): "${where || ''}"\n\nReturn the JSON now.`;

  try {
    const parsed = await complete({
      task: 'extract',
      system: SYSTEM,
      user: userPrompt,
      json: true,
      temperature: 0.2,
      maxTokens: 800
    });
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'extraction failed', raw: err.raw });
  }
}
