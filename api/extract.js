// /api/extract — voice/text dump → structured fields.
// Routed via _models.js so the underlying provider can be swapped per-task
// via env vars (see _models.js docstring). Default is Gemini 2.5 Flash.

import { complete } from './_models.js';

const SYSTEM = `You extract structured details from a person's quick voice memo about people they just met. The output feeds a memory-trigger system, so EVERY FIELD is engineered to spark the user's recall later — not to be a generic CRM record.

EXTRACTION RULES, in order of priority:

1. LEAD WITH ATYPICAL DETAILS. The brain remembers what stands out (von Restorff). In the headline AND in the traits array, prefer distinctive observations ("heavily tattooed", "twin huskies named Storm and Echo", "Texas-A&M-superfan-with-the-flag-shirt") over generic ones ("friendly", "tall", "professional"). If only generic descriptors exist, leave the field shorter — don't pad.

2. CAP TRAITS AT 4. Working memory holds about 4 chunks (Cowan, 2001). 5+ trait entries dilute the signal and waste prompt budget downstream. Pick the 4 most distinctive.

3. NEVER INVENT. Hedging is worse than empty. If the source says "a couple", don't infer "married couple". If the source doesn't say a name, don't invent one. If the source mentions kids without names, kids: [] not kids: ["unnamed son"].

4. CAPTURE FOLLOW-UP THREADS. If the source mentions something the user might bring up next time — an upcoming trip, a project, a kid's milestone, a hobby they were excited about — include it in the summary as a final clause. These are the next-handshake hooks the briefing endpoint wants.

5. KEEP KIDS / PETS DISTINCT. A dog named Otis goes in pets, not in the summary's kid list. The brain conflates these less when the data is structured.

6. SECOND-PERSON, WARM, TERSE. Summary is "You met..." not "Subject was met...". 2-3 sentences max.

Return ONLY valid JSON in this exact shape, no preamble, no markdown fences:
{
  "headline": "8 words max. Lead with the most distinctive detail. e.g. 'Tattooed couple from California with kid Malachi'.",
  "summary": "2-3 sentences in second person. Names if known, distinctive traits, kids/pets by name, end with a follow-up thread if any.",
  "names": ["explicit adult names mentioned, ordered as they appeared"],
  "kids": ["kids' PROPER-NOUN names only. If the source gives count without names ('mom of two', 'three kids'), leave empty array. Do not include pets here."],
  "pets": ["pets formatted as 'Name (species)' e.g. 'Otis (pug)'. PROPER NOUNS only. If the source gives count without names ('two huskies', 'a dog'), leave empty array."],
  "traits": ["max 4 distinctive observations; skip generic ones"],
  "where": "Where they met, inferred from voice memo + user input. Short phrase, title-cased if it's a proper place."
}

If a field has no info, use an empty string or empty array. Be terse.`;

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
      // Bumped 800 -> 1400 to match the richer prompt; mid-string truncation
      // returns malformed JSON which 502s the whole call (same fix logic
      // applied to /api/brief in v1.5.2).
      maxTokens: 1400
    });
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'extraction failed', raw: err.raw });
  }
}
