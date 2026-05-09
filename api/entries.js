// /api/entries
//
// GET                                  -> all root entries (parent_id IS NULL), newest first
// GET ?id=<uuid>&include=children      -> a single entry with its child notes (timeline)
// POST                                 -> create entry. Optionally { parent_id } to attach as a note.
// PATCH ?id=<uuid>                     -> update fields
// DELETE ?id=<uuid>                    -> delete (cascade removes children)

import { requireUser } from './_supabase.js';

export default async function handler(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return;
  const { user, supa } = auth;

  try {
    if (req.method === 'GET') {
      const id = req.query?.id;
      const include = req.query?.include;

      if (id && include === 'children') {
        const { data: rootData, error: rootErr } = await supa
          .from('entries')
          .select('*')
          .eq('id', id)
          .maybeSingle();
        if (rootErr) throw rootErr;
        if (!rootData) return res.status(404).json({ error: 'not found' });
        const rootId = rootData.parent_id || rootData.id;
        // Defensive: pre-schema-v3 the .or with parent_id will error. Catch and fall back to root-only.
        try {
          const { data: thread, error: tErr } = await supa
            .from('entries')
            .select('*')
            .or(`id.eq.${rootId},parent_id.eq.${rootId}`)
            .order('created_at', { ascending: true });
          if (tErr) throw tErr;
          return res.status(200).json({ thread });
        } catch {
          return res.status(200).json({ thread: [rootData] });
        }
      }

      const { data: allEntries, error } = await supa
        .from('entries')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;

      const roots = (allEntries || []).filter(e => !e.parent_id);
      const childCounts = {};
      const childLatest = {};
      (allEntries || []).filter(e => e.parent_id).forEach(c => {
        childCounts[c.parent_id] = (childCounts[c.parent_id] || 0) + 1;
        const prev = childLatest[c.parent_id];
        if (!prev || new Date(c.created_at) > new Date(prev)) childLatest[c.parent_id] = c.created_at;
      });
      roots.forEach(r => {
        r.note_count = childCounts[r.id] || 0;
        r.last_seen = childLatest[r.id] || r.created_at;
      });

      return res.status(200).json({ entries: roots });
    }

    if (req.method === 'POST') {
      const body = req.body || {};
      const row = {
        user_id: user.id,
        raw: body.raw || '',
        headline: body.headline || null,
        summary: body.summary || null,
        where_met: body.where_met || body.where || null,
        names: Array.isArray(body.names) ? body.names : [],
        kids: Array.isArray(body.kids) ? body.kids : [],
        pets: Array.isArray(body.pets) ? body.pets : [],
        traits: Array.isArray(body.traits) ? body.traits : [],
        next_likely_at: body.next_likely_at || null,
        next_likely_where: body.next_likely_where || null
      };
      // parent_id only exists once schema-v3 has been applied. Skip the column
      // entirely if no parent — keeps inserts working pre-migration.
      if (body.parent_id) row.parent_id = body.parent_id;
      const { data, error } = await supa
        .from('entries')
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'PATCH') {
      const id = req.query.id || (req.body && req.body.id);
      if (!id) return res.status(400).json({ error: 'id required' });
      const allowed = ['headline','summary','where_met','names','kids','pets','traits','next_likely_at','next_likely_where','raw'];
      const patch = {};
      for (const k of allowed) if (k in (req.body || {})) patch[k] = req.body[k];
      const { data, error } = await supa
        .from('entries')
        .update(patch)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ entry: data });
    }

    if (req.method === 'DELETE') {
      const id = req.query.id;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await supa.from('entries').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'entries failed' });
  }
}
