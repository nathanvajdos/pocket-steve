// /api/calendar-scan
//
// Vercel Cron handler. Runs daily.
// For each user with a calendar_ics_url:
//   1. Fetch their .ics
//   2. Parse upcoming 7 days of events
//   3. Use Gemini to fuzzy-match events against the user's saved entries
//   4. For each unmatched (event, entry) pair, email a memory-trigger briefing
//   5. Record nudges_sent so we don't spam

import { serviceClient } from './_supabase.js';
import { parseIcs, eventsInWindow } from './_ics.js';
import { sendEmail } from './_email.js';
import { getValidAccessToken, fetchEventsInWindow } from './_microsoft.js';
import { complete } from './_models.js';

export default async function handler(req, res) {
  // When CRON_SECRET is set, Vercel Cron sends "Authorization: Bearer $CRON_SECRET".
  // For manual triggering during dev, also accept ?secret=$CRON_SECRET.
  const expected = process.env.CRON_SECRET;
  const auth = req.headers.authorization || '';
  const querySecret = req.query?.secret;
  const ok = expected && (auth === `Bearer ${expected}` || querySecret === expected);
  if (!ok) {
    return res.status(401).json({ error: 'Not authorized' });
  }

  const supa = serviceClient();
  const now = Date.now();
  const horizon = now + 7 * 24 * 60 * 60 * 1000;
  const startISO = new Date(now).toISOString();
  const endISO = new Date(horizon).toISOString();

  // 1. Build the union of users-to-scan: anyone with an .ics URL OR an OAuth connection.
  const [{ data: icsProfiles }, { data: oauthRows }] = await Promise.all([
    supa.from('profiles').select('user_id, email, calendar_ics_url').not('calendar_ics_url', 'is', null),
    supa.from('oauth_tokens').select('user_id, account_email').eq('provider', 'microsoft')
  ]);
  const oauthIds = new Set((oauthRows || []).map(o => o.user_id));
  const icsIds = new Set((icsProfiles || []).map(p => p.user_id));
  const allUserIds = new Set([...oauthIds, ...icsIds]);

  // Fetch fresh emails for users coming in via the oauth path who don't have a profile row yet.
  const { data: profileRows } = await supa
    .from('profiles')
    .select('user_id, email, calendar_ics_url')
    .in('user_id', Array.from(allUserIds));
  const profileMap = new Map((profileRows || []).map(p => [p.user_id, p]));

  const summary = { users: allUserIds.size, nudges: 0, errors: [] };

  for (const userId of allUserIds) {
    const p = profileMap.get(userId) || { user_id: userId, email: null, calendar_ics_url: null };
    try {
      // 2. Fetch upcoming events — prefer Microsoft OAuth if connected, else .ics URL
      let upcoming = [];
      if (oauthIds.has(userId)) {
        const accessToken = await getValidAccessToken(userId);
        if (!accessToken) {
          summary.errors.push({ user: p.email, step: 'ms-token-refresh' });
          continue;
        }
        upcoming = await fetchEventsInWindow({ accessToken, startISO, endISO });
      } else if (p.calendar_ics_url) {
        const icsResp = await fetch(p.calendar_ics_url, { redirect: 'follow' });
        if (!icsResp.ok) {
          summary.errors.push({ user: p.email, step: 'fetch-ics', status: icsResp.status });
          continue;
        }
        const ics = await icsResp.text();
        const allEvents = parseIcs(ics);
        upcoming = eventsInWindow(allEvents, now, horizon);
      }
      if (!upcoming.length) continue;

      // 3. User's entries
      const { data: entries, error: eErr } = await supa
        .from('entries')
        .select('id, headline, summary, where_met, raw, created_at')
        .eq('user_id', p.user_id);
      if (eErr) { summary.errors.push({ user: p.email, step: 'entries', err: eErr.message }); continue; }
      if (!entries?.length) continue;

      // 4. Ask Gemini to find matches
      const matches = await askGeminiForMatches(upcoming, entries);
      if (!matches?.length) continue;

      // 5. For each match, send email if not already nudged
      for (const m of matches) {
        const event = upcoming.find(ev => ev.uid === m.event_uid) || upcoming[m.event_index];
        if (!event) continue;

        const entry = entries.find(e => e.id === m.entry_id);
        if (!entry) continue;

        // Dedup
        const dedupKey = event.uid || `${event.summary}-${event.startsAt}`;
        const { data: existing } = await supa
          .from('nudges_sent')
          .select('id')
          .eq('user_id', p.user_id)
          .eq('calendar_event_uid', dedupKey)
          .eq('entry_id', entry.id)
          .maybeSingle();
        if (existing) continue;

        // Send email
        await sendEmail({
          to: p.email,
          subject: `Heads-up: you'll likely see someone you've met — ${event.summary || 'upcoming event'}`,
          html: emailBody({ event, entry, briefing: m.briefing })
        });

        await supa.from('nudges_sent').insert({
          user_id: p.user_id,
          calendar_event_uid: dedupKey,
          entry_id: entry.id,
          event_starts_at: event.startsAt
        });

        summary.nudges += 1;
      }
    } catch (err) {
      summary.errors.push({ user: p.email, err: err.message });
    }
  }

  return res.status(200).json(summary);
}

async function askGeminiForMatches(events, entries) {
  const eventList = events.map((e, i) => ({
    index: i,
    uid: e.uid,
    summary: e.summary,
    location: e.location,
    startsAt: e.startsAt
  }));
  const entryList = entries.map(e => ({
    id: e.id,
    where_met: e.where_met,
    headline: e.headline
  }));

  const systemInstruction = `You match upcoming calendar events to past meetings, so the user can be reminded who they might see at each event.

Match an event to an entry only if there is a clear semantic overlap between the event (title or location) and where the entry was met. Examples:
- Event "Soccer practice" at "Lincoln Park" + entry where_met "Lincoln Park" -> match
- Event "Carnival at Elementary School" + entry where_met "Elementary School Carnival" -> match
- Event "Dentist appointment" + entry where_met "Ohio Park" -> NO match
Be strict. False positives waste the user's attention.

For each match, also write a 1-2 sentence memory-trigger briefing in second person about that entry, suitable for an email subject-line tease and body.

Return ONLY valid JSON in this shape, no preamble:
{
  "matches": [
    { "event_index": <int>, "event_uid": "<string or empty>", "entry_id": "<uuid>", "briefing": "<2 sentences>" }
  ]
}
Empty matches array if nothing fits.`;

  const userPrompt = `Upcoming events:\n${JSON.stringify(eventList, null, 2)}\n\nPast meetings:\n${JSON.stringify(entryList, null, 2)}\n\nReturn the JSON now.`;

  const parsed = await complete({
    task: 'calendar',
    system: systemInstruction,
    user: userPrompt,
    json: true,
    temperature: 0.2,
    maxTokens: 2000
  });
  return parsed?.matches || [];
}

function emailBody({ event, entry, briefing }) {
  const when = event.startsAt ? new Date(event.startsAt).toLocaleString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
  }) : 'soon';
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:16px;line-height:1.5;color:#1a1a1a;max-width:560px;">
    <p style="color:#666;font-size:14px;margin:0 0 8px;">${when} &middot; ${escape(event.summary || 'upcoming event')}${event.location ? ' &middot; ' + escape(event.location) : ''}</p>
    <h2 style="margin:8px 0 16px;">${escape(entry.headline || "Someone you've met")}</h2>
    <p style="font-size:17px;">${escape(briefing || entry.summary || '')}</p>
    <p style="color:#666;font-size:13px;margin-top:24px;">Memory trigger from Pocket Steve. Where you met them: <em>${escape(entry.where_met || '')}</em></p>
  </div>`;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
