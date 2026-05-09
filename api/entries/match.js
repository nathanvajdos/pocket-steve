// /api/entries/match
//
// Given a freshly-extracted capture (headline/summary/where), find the
// most likely existing root-entry it could be a re-meeting of. Returns
// best match + confidence so the frontend can prompt the user.

import { requireUser } from '../_supabase.js';
import { complete } from '../_models.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supa } = auth;

  const { headline, summary, where, names, kids, pets } = req.body || {};
  if (!headline && !summary) {
    return res.status(400).json({ error: 'headline or summary required' });
  }

  // Fetch all entries for this user, filter to roots client-side.
  // (Defensive: works pre- and post-schema-v3 since we don't reference parent_id in the SQL filter.)
  const { data: rawEntries, error } = await supa
    .from('entries')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(400);
  if (error) return res.status(500).json({ error: error.message });
  const candidates = (rawEntries || []).filter(e => !e.parent_id).slice(0, 200);
  if (!candidates.length) return res.status(200).json({ match: null });

  // Quick local prefilter: any candidate that shares a name, kid, or pet with the new capture
  // jumps to the top. Otherwise consider all and let Gemini judge.
  const newNames = (names || []).map(s => String(s).toLowerCase());
  const newKids = (kids || []).map(s => String(s).toLowerCase());
  const newPets = (pets || []).map(s => String(s).toLowerCase());

  const overlaps = (cand) => {
    const cn = (cand.names || []).map(s => String(s).toLowerCase());
    const ck = (cand.kids || []).map(s => String(s).toLowerCase());
    const cp = (cand.pets || []).map(s => String(s).toLowerCase());
    return [...newNames, ...newKids, ...newPets].some(x =>
      cn.includes(x) || ck.includes(x) || cp.includes(x)
    );
  };
  const top = candidates.filter(overlaps);
  const pool = top.length ? top : candidates.slice(0, 25);

  const newPerson = {
    headline: headline || '',
    summary: summary || '',
    where: where || '',
    names: names || [],
    kids: kids || [],
    pets: pets || []
  };

  const systemInstruction = `You decide whether a brand-new capture about a person/group describes the SAME person/group as one of the existing root entries in their journal.

A match means: this new note is about a person they've already saved — they ran into the same person again (or are filling in more detail). Same KIDS' names, same PETS, same DISTINCTIVE NAMES, plus same context (location, role) is a strong match. A common first name alone is NOT enough.

Return ONLY valid JSON in this shape, no preamble:
{
  "match_id": "<uuid of existing entry, or empty string if no match>",
  "confidence": "high" | "medium" | "low" | "none",
  "reason": "1-sentence explanation"
}

Be strict about high confidence. False merges are worse than missed merges; users can manually merge later but can't easily un-merge from a wrong auto-decision.`;

  const userPrompt = `New capture:\n${JSON.stringify(newPerson, null, 2)}\n\nExisting root entries to compare:\n${JSON.stringify(
    pool.map(c => ({
      id: c.id,
      headline: c.headline,
      summary: c.summary,
      where: c.where_met,
      names: c.names,
      kids: c.kids,
      pets: c.pets,
      traits: c.traits
    })),
    null,
    2
  )}\n\nReturn the JSON now.`;

  try {
    const parsed = await complete({
      task: 'match',
      system: systemInstruction,
      user: userPrompt,
      json: true,
      temperature: 0.1,
      maxTokens: 400
    });

    if (!parsed.match_id) return res.status(200).json({ match: null });
    const matched = candidates.find(c => c.id === parsed.match_id);
    if (!matched) return res.status(200).json({ match: null });

    return res.status(200).json({
      match: {
        entry: matched,
        confidence: parsed.confidence || 'medium',
        reason: parsed.reason || ''
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'match failed' });
  }
}
