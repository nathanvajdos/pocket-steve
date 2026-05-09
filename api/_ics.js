// Minimal .ics parser. Pulls VEVENT blocks with SUMMARY, LOCATION, DTSTART, UID.
// Good enough for iCloud / Google / Outlook public calendar feeds.

export function parseIcs(text) {
  const events = [];
  const lines = unfold(text).split(/\r?\n/);
  let cur = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') {
      if (cur) events.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const head = line.slice(0, idx);     // e.g. DTSTART;TZID=America/Chicago
    const value = line.slice(idx + 1);
    const [name] = head.split(';');

    if (name === 'UID') cur.uid = value;
    else if (name === 'SUMMARY') cur.summary = unescapeIcs(value);
    else if (name === 'LOCATION') cur.location = unescapeIcs(value);
    else if (name === 'DESCRIPTION') cur.description = unescapeIcs(value);
    else if (name === 'DTSTART') cur.startsAt = parseIcsDate(value, head);
    else if (name === 'DTEND') cur.endsAt = parseIcsDate(value, head);
  }
  return events;
}

// ICS supports "folding": continuation lines start with a space/tab. Unfold them.
function unfold(text) {
  return text.replace(/\r?\n[ \t]/g, '');
}

function unescapeIcs(s) {
  return s.replace(/\\n/g, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');
}

// Parse YYYYMMDD or YYYYMMDDTHHmmssZ -> ISO string
function parseIcsDate(value, head) {
  const v = value.trim();
  if (/^\d{8}$/.test(v)) {
    // All-day
    return `${v.slice(0,4)}-${v.slice(4,6)}-${v.slice(6,8)}T00:00:00Z`;
  }
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (m) {
    const [, y, mo, d, h, mi, s, z] = m;
    if (z === 'Z') return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
    // Floating / TZID — treat as UTC for simplicity.
    return `${y}-${mo}-${d}T${h}:${mi}:${s}Z`;
  }
  return null;
}

export function eventsInWindow(events, fromMs, toMs) {
  return events.filter(e => {
    if (!e.startsAt) return false;
    const t = Date.parse(e.startsAt);
    return t >= fromMs && t <= toMs;
  }).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
