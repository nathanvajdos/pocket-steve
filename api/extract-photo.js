// Vercel serverless function — turns a photo of a name tag, business card,
// or person into structured fields. Uses Gemini 2.5 Flash with vision.
//
// Body: { imageBase64: "<base64 data, no data: prefix>", mimeType: "image/jpeg", text?: "<any voice memo to combine>" }
// Returns same shape as /api/extract.

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const MAX_IMAGE_BYTES = 6 * 1024 * 1024; // ~6MB hard cap for serverless body

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

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  const systemInstruction = `You extract structured details from a photo a user took at an event. The photo could be:
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

  const userParts = [
    { inlineData: { mimeType: mt, data: imageBase64 } }
  ];
  if (text && text.trim()) {
    userParts.push({ text: `Optional voice memo from the user: "${text.trim()}"` });
  } else {
    userParts.push({ text: 'No voice memo. Extract from the image only.' });
  }

  try {
    const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts: userParts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 900,
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
    return res.status(500).json({ error: err.message || 'photo extraction failed' });
  }
}
