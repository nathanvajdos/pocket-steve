// Vercel serverless function — turns a LinkedIn URL OR pasted profile text
// into the same structured fields as /api/extract.
//
// Body:  { url?: string, text?: string }
// At least one of url/text is required. If both are provided, both are
// included in the prompt (URL fetch as primary, text as fallback/extra).

import { complete } from './_models.js';

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

  const systemInstruction = `You extract structured details about a person from a snippet of web content (a LinkedIn profile, personal website, conference bio, or pasted text). The output feeds a memory-trigger system, so EVERY FIELD is engineered to spark recall later — not to be a generic CRM record.

EXTRACTION RULES, in order of priority:

1. LEAD WITH ATYPICAL DETAILS. The brain remembers what stands out (von Restorff). In the headline AND in traits, prefer distinctive observations ("ex-Stripe Staff Eng now at Series-A", "marathoner + dad of two", "Stanford CS '14 with a published novel") over generic ones ("experienced professional", "results-driven", "team player"). LinkedIn is full of generic boilerplate; ignore it.

2. CAP TRAITS AT 4. Working memory holds about 4 chunks (Cowan, 2001). Pick the 4 most distinctive — typically: current role+company, one notable past, one distinctive personal/hobby thread, one location/origin if regional matters.

3. NEVER INVENT. If only a current title is visible, traits include the title — not an inferred specialty. If the source is a login wall with no real data, return empty fields with a 'raw_text' note explaining what you saw.

4. CAPTURE FOLLOW-UP THREADS. If the source reveals something the user could bring up next time — a current project, a recent move, a kid's milestone the user mentioned, a side hustle, a published talk — include it in the summary as a final clause. These are the next-handshake hooks the briefing endpoint will surface.

5. STRIP THE LINKEDIN BULLSHIT. Phrases like "passionate about", "results-driven", "thought leader", "synergies", "10x", "rockstar", or any title-case buzzword soup belong in raw_text only — never in summary or traits.

6. SECOND-PERSON, WARM, TERSE. "You met..." not "Subject is...". 2-3 sentences max in the summary.

Return ONLY valid JSON in this exact shape, no preamble, no markdown fences:
{
  "headline": "8 words max. Lead with the most distinctive concrete detail. e.g. 'Sarah Chen, ex-Stripe PM, now Director at Notion'.",
  "summary": "2-3 sentences in second person. Lead with name + current role/company, one distinctive past or trait, end with a follow-up thread if any.",
  "names": ["full name as it appears in the source"],
  "kids": [],
  "pets": [],
  "traits": ["max 4 distinctive entries — current role+company, notable past, distinctive personal thread, regional origin if relevant. Skip buzzwords."],
  "where": "Empty unless the snippet specifies a real event/place the user might have met them at.",
  "linkedin_url": "If a LinkedIn URL was provided or visible in the content, return it. Otherwise empty string.",
  "raw_text": "Verbatim key phrases extracted, comma-separated. Source-of-truth audit trail."
}

If a field has no info, use an empty string or empty array.`;

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
    const parsed = await complete({
      task: 'linkedin',
      system: systemInstruction,
      user: parts,
      json: true,
      temperature: 0.2,
      // Bumped 900 -> 1500 to match the richer prompt; same truncation-502
      // lineage as v1.5.2 (brief), v1.6.3 (extract), v1.6.4 (photo).
      maxTokens: 1500
    });
    if (cleanUrl && !parsed.linkedin_url) parsed.linkedin_url = cleanUrl;
    if (fetchNote) parsed._fetchNote = fetchNote;

    return res.status(200).json(parsed);
  } catch (err) {
    return res.status(502).json({ error: err.message || 'linkedin enrich failed', raw: err.raw });
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
