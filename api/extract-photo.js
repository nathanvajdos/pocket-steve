// /api/extract-photo — photo (name tag, business card, person) → structured fields.
// Routed via _models.js. Vision-capable providers (Gemini, OpenAI gpt-4o-mini)
// can handle this. Default routing: MODEL_PHOTO=gemini,openai.

import { complete } from './_models.js';
import { requireUser } from './_supabase.js';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const SYSTEM = `You extract structured details from a photo a user took at an event — name tag, conference badge, business card, person wearing a lanyard, LinkedIn screenshot, or scene with readable text. Read every legible word. Combine with any optional voice memo the user provides for additional context. The output feeds a memory-trigger system, so EVERY FIELD is engineered to spark recall later.

EXTRACTION RULES, in order of priority:

1. LEAD WITH ATYPICAL DETAILS. The brain remembers what stands out (von Restorff). In the headline AND in traits, prefer distinctive observations ("CTO at a Series-A insurtech", "Nashville Marathon shirt", "purple-streaked hair") over generic ones ("smiling", "professional", "conference attendee"). If the source has only generic stuff, leave the field shorter — don't pad.

2. CAP TRAITS AT 4. Working memory holds about 4 chunks (Cowan, 2001). 5+ entries dilute the signal.

3. NEVER INVENT. If only the company is visible, traits include the company — not an inferred role. If a name tag shows "Ranbir P." don't expand to "Patel". Hedging is worse than empty.

4. CAPTURE FOLLOW-UP THREADS. If the image or voice memo reveals something to bring up next time (a project they were promoting, a conference talk topic, a hometown, a sticker on their badge from a memorable team), include it in the summary's final clause. These are the next-handshake hooks the briefing endpoint will want to surface.

5. PRIORITIZE WHAT THE PHOTO PROVES OVER WHAT IT IMPLIES. Visible text on a card or badge is highest-confidence and goes in names/traits/where. Visual aesthetic (clothing, posture, vibe) is fine for the summary but only if distinctive.

6. SECOND-PERSON, WARM, TERSE. "You met..." not "Subject was photographed...". 2-3 sentences max in the summary.

Return ONLY valid JSON in this exact shape, no preamble, no markdown fences:
{
  "headline": "8 words max. Lead with the most distinctive concrete detail. e.g. 'Ranbir Patel, VP Eng at Acme'.",
  "summary": "2-3 sentences in second person. Names if known, role/company if visible, one distinctive detail, end with a follow-up thread if any.",
  "names": ["all visible/audible names, exactly as written on badge/card"],
  "kids": ["kids' PROPER-NOUN names from voice memo only. If the user says count without names ('two kids'), leave empty array."],
  "pets": ["pets from voice memo formatted as 'Otis (pug)'. PROPER NOUNS only. If the user says count without names ('a dog'), leave empty array."],
  "traits": ["max 4 distinctive observations: company, role, visible affiliations, conference, voice-memo notes"],
  "where": "Inferred event/place if visible (e.g. 'TechConf 2026'). Empty string if unclear.",
  "raw_text": "Verbatim text visible in the image, line-separated. Source-of-truth audit trail."
}

If a field has no info, use an empty string or empty array. If the image is unreadable or off-topic, return empty fields with a 'raw_text' note explaining what you saw.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Auth gate: paid Vision call. Anonymous Supabase sessions pass; only
  // fully unauthenticated traffic is blocked. Closes the cost vector.
  const auth = await requireUser(req, res);
  if (!auth) return;

  const { imageBase64, mimeType, text } = req.body || {};
  if (!imageBase64 || typeof imageBase64 !== 'string') {
    return res.status(400).json({ error: 'imageBase64 required' });
  }
  if (imageBase64.length > MAX_IMAGE_BYTES * 1.4) {
    return res.status(413).json({ error: 'Image too large after compression. Try again — should be under 5MB.' });
  }
  const mt = (mimeType || 'image/jpeg').toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'].includes(mt)) {
    return res.status(400).json({ error: 'Unsupported image type: ' + mt });
  }

  const userParts = [{ inlineData: { mimeType: mt, data: imageBase64 } }];
  if (text && text.trim()) {
    userParts.push({ text: `Optional voice memo from the user: "${text.trim()}"` });
  } else {
    userParts.push({ text: 'No voice memo. Extract from the image only.' });
  }

  try {
    const parsed = await complete({
      task: 'photo',
      system: SYSTEM,
      user: userParts,
      json: true,
      temperature: 0.2,
      // Bumped 900 -> 1500 to match the richer prompt (same fix lineage as
      // /api/extract v1.6.3 and /api/brief v1.5.2 — mid-string truncation
      // on JSON-mode output 502s the whole call).
      maxTokens: 1500
    });
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'photo extraction failed', raw: err.raw });
  }
}
