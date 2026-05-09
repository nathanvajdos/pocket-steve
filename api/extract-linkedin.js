// Vercel serverless function — turns a LinkedIn URL OR pasted profile text
// into the same structured fields as /api/extract.
//
// Body:  { url?: string, text?: string }
// At least one of url/text is required. If both are provided, both are
// included in the prompt (URL fetch as primary, text as fallback/extra).

const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const FETCH_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache'
};

const MAX_FETCH_BYTES = 800_000; // cap on remote HTML size

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { url, text } = req.body || {};
  const cleanUrl = (url || '').toString().trim();
  const cleanText = (text || '').toString().trim();

  if (!cleanUrl && !cleanText) {
    return res.status(400).json({ error: 'url or text required' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not set' });

  // 1. If a URL was provided, try to fetch its public content.
  let fetched = null;
  let fetchNote = null;
  if (cleanUrl) {
    if (!/^https?:\/\//.test(cleanUrl)) {
      return res.status(400).json({ error: 'URL must start with http(s)://' });
    }
    try {
      const r = await fetch(cleanUrl, { headers: FETCH_HEADERS, redirect: 'follow' });
      if (!r.ok) {
        fetchNote = `URL returned HTTP ${r.status}; using pasted text only if any.`;
      } else {
        const buf = await r.arrayBuffer();
        const html = new TextDecoder('utf-8').decode(buf.slice(0, MAX_FETCH_BYTES));
        fetched = compactHtml(html);
      }
    } catch (e) {
      fetchNote = `URL fetch failed: ${e.message}. Using pasted text only if any.`;
    }
  }

  if (!fetched && !cleanText) {
    return res.status(422).json({
      error: 'Could not read that URL (LinkedIn often blocks unauthenticated fetches). Copy the visible text from the profile and paste it here instead.',
      fetchNote
    });
  }

  const systemInstruction = `You extract structured details about a person from a snippet of web content (a LinkedIn profile, personal website, conference bio, or pasted text). The user wants to remember this person.

Return ONLY valid JSON in this exact shape, no preamble:
{
  "headline": "Short label (8 words max), e.g. 'Ranbir Patel, VP Eng at Acme'",
  "summary": "2-3 sentence second-person summary suitable as a memory trigger. Lead with name, current role + company. Mention notable past or distinctive details.",
  "names": ["full name as found"],
  "kids": [],
  "pets": [],
  "traits": ["company, role, location, notable past, anything that helps remember them"],
  "where": "Empty unless the snippet mentions a specific event/place where the user might have met them.",
  "linkedin_url": "If a LinkedIn URL was provided or visible in the content, return it. Otherwise empty string.",
  "raw_text": "Verbatim key phrases extracted, comma-separated. Used as a fallback / source-of-truth audit trail."
}

If a field has no info, use an empty string or empty array. Never invent details. If the content looks like a login wall or generic redirect (no real profile data), return mostly empty fields and put a note in raw_text.`;

  const parts = [];
  if (fetched) {
    parts.push({ text: `Fetched HTML content (compacted) from URL "${cleanUrl}":\n\n${fetched.slice(0, 25_000)}` });
  } else if (cleanUrl) {
    parts.push({ text: `URL provided but not fetchable: ${cleanUrl}` });
  }
  if (cleanText) {
    parts.push({ text: `User-pasted profile text:\n\n${cleanText}` });
  }

  try {
    const r = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents: [{ role: 'user', parts }],
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
    if (cleanUrl && !parsed.linkedin_url) parsed.linkedin_url = cleanUrl;
    if (fetchNote) parsed._fetchNote = fetchNote;

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(500).json({ error: err.message || 'linkedin enrich failed' });
  }
}

// Strip HTML to a much shorter signal-only string before sending to the model:
// drop scripts/styles/comments, collapse whitespace, keep og: meta + visible text.
function compactHtml(html) {
  let s = html;
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  s = s.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ');

  // Capture OG/Twitter/title meta separately and prepend (high signal).
  const metaPicks = [];
  const metaRegex = /<meta[^>]+(property|name)\s*=\s*["']([^"']+)["'][^>]*content\s*=\s*["']([^"']*)["'][^>]*>/gi;
  let m;
  while ((m = metaRegex.exec(html)) !== null) {
    const key = m[2];
    const val = m[3];
    if (/^(og:|twitter:|description|author|application-name)/i.test(key) && val) {
      metaPicks.push(`${key}: ${val}`);
    }
  }
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Strip remaining tags + collapse whitespace.
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/\s+/g, ' ').trim();

  return [
    title ? `TITLE: ${title}` : '',
    metaPicks.length ? `META:\n${metaPicks.join('\n')}` : '',
    `BODY: ${s}`
  ].filter(Boolean).join('\n\n');
}
