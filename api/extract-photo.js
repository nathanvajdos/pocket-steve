// /api/extract-photo — photo (name tag, business card, person) → structured fields.
// Routed via _models.js. Vision-capable providers (Gemini, OpenAI gpt-4o-mini)
// can handle this. Default routing: MODEL_PHOTO=gemini,openai.

import { complete } from './_models.js';

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

const SYSTEM = `You extract structured details from a photo a user took at an event. The photo could be:
- A name tag or conference badge
- A business card
- A person (sometimes both — a person wearing a name tag)
- A LinkedIn profile screenshot
- A handshake / event scene with readable text

Read every legible word. Combine with any optional voice memo the user provides for additional context.

Return ONLY valid JSON matching this shape, no preamble:
{
  "headline": "Short label (8 words max), e.g. 'Ranbir Patel, VP Eng at Acme'",
  "summary": "2-3 sentence second-person summary suitable for a memory trigger later. Lead with name + company/role if known. Mention distinctive visual or contextual details (warm smile, conference lanyard, etc.) only if observable.",
  "names": ["all visible/audible names"],
  "kids": ["any kids' names mentioned in voice memo"],
  "pets": ["any pets mentioned in voice memo, formatted as 'Otis (dog)'"],
  "traits": ["distinctive observations: company, role, visible affiliations, voice-memo traits"],
  "where": "Inferred event/place if any (e.g. 'TechConf 2026', 'Sales Kickoff'). Empty string if unclear.",
  "raw_text": "Verbatim text visible in the image, line-separated. Used as a fallback / source of truth."
}

If a field has no info, use an empty string or empty array. Never invent details. If the image is unreadable or off-topic, return empty fields with a 'raw_text' note explaining what you saw.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

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
      maxTokens: 900
    });
    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'photo extraction failed', raw: err.raw });
  }
}
