// Steve — multi-user cloud sync + auth + calendar nudges.
//
// Auth is via Supabase magic links. Entries and profile are cloud-synced
// per user. Old v0 data in localStorage is migrated on first login.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let supabase = null;
let currentUser = null;
let sessionToken = null;

const LEGACY_STORE_KEY = 'steve.entries.v1';

// ---------- bootstrap ----------

(async function init() {
  // Pull Supabase config from our serverless endpoint so it isn't hardcoded.
  const cfgResp = await fetch('/api/config');
  const cfg = await cfgResp.json();
  if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) {
    showLogin('Server is missing Supabase config. Tell Nathan.');
    return;
  }

  supabase = createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
    auth: {
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true,
      flowType: 'pkce'
    }
  });

  // Wait for Supabase to consume any magic-link tokens that may be in the URL hash.
  const { data: { session } } = await supabase.auth.getSession();
  if (session) {
    onSignedIn(session);
  } else {
    // Try anonymous sign-in first — zero-friction entry. Anyone landing on
    // the URL gets a working session immediately, no email entry, no second
    // email round-trip. They can later "claim" the account by adding email
    // in Settings, which preserves all their captured entries.
    //
    // Requires Anonymous Sign-Ins to be enabled in Supabase project settings
    // (Authentication → Providers → Anonymous Sign-Ins → Enable). If disabled,
    // this throws and we fall through to the magic-link login screen.
    try {
      const { data, error } = await supabase.auth.signInAnonymously();
      if (error) throw error;
      if (data?.session) {
        onSignedIn(data.session);
      } else {
        showLogin();
      }
    } catch (err) {
      console.info('[auth] anonymous sign-in unavailable, falling back to magic link:', err.message);
      showLogin();
    }
  }

  // Subscribe to auth changes so post-login redirects flow naturally.
  supabase.auth.onAuthStateChange((_event, sess) => {
    if (sess) onSignedIn(sess);
    else showLogin();
  });

  // Clean tokens out of the URL after Supabase has consumed them.
  if (location.hash.includes('access_token') || location.search.includes('code=')) {
    history.replaceState({}, '', location.pathname);
  }

  showInstallHintIfNeeded();
})();

// ---------- view switching ----------

function go(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + view);
  if (target) target.classList.add('active');
  window.scrollTo(0, 0);
  if (view === 'library') renderLibrary();
  if (view === 'settings') renderSettings();
  if (view === 'home') renderTopOfMind();
}

// ---------- shared place autocomplete (datalist#places) ----------
//
// Populated from the user's saved entries so typing into any "where" field
// surfaces the places they've already used. Reduces typos that would otherwise
// break the fuzzy briefing match, and lets Steve feel like he knows their
// world. Browser-native datalist for graceful behavior on every platform.

function refreshPlacesDatalist(entries) {
  const dl = document.getElementById('places');
  if (!dl || !Array.isArray(entries)) return;
  const seen = new Set();
  const places = [];
  for (const e of entries) {
    const candidates = [e.where_met, e.next_likely_where];
    for (const c of candidates) {
      if (!c) continue;
      const key = String(c).trim();
      if (!key) continue;
      const k = key.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      places.push(key);
    }
  }
  // Sort by length-then-alpha so common short places come first
  places.sort((a, b) => a.length - b.length || a.localeCompare(b));
  dl.innerHTML = places.map(p => `<option value="${escapeAttr(p)}"></option>`).join('');
}

// ---------- Top of mind: proactive surface on home screen ----------
//
// Shows the user upcoming/recently-relevant people without making them
// search. Three signals, in priority order:
//   1. Entries with next_likely_at within the next 7 days (user said "I'll
//      see them at X on date Y" during capture)
//   2. Entries captured in the last 7 days (recent enough to nudge re-meet)
//   3. Latest 3 entries by recency
// At least one of these is almost always non-empty after the first capture.

async function renderTopOfMind() {
  const panel = document.getElementById('top-of-mind');
  const list = document.getElementById('tom-list');
  const sub = document.getElementById('tom-sub');
  if (!panel || !currentUser) return;

  panel.hidden = true;
  try {
    const r = await fetchAuth('/api/entries', { method: 'GET' });
    if (!r.ok) return;
    const { entries } = await r.json();
    refreshPlacesDatalist(entries || []);
    if (!entries || !entries.length) return;

    const now = Date.now();
    const sevenDaysFromNow = now + 7 * 86400 * 1000;
    const sevenDaysAgo = now - 7 * 86400 * 1000;

    // Priority 1: upcoming next_likely_at
    const upcoming = entries
      .filter(e => e.next_likely_at && new Date(e.next_likely_at).getTime() > now && new Date(e.next_likely_at).getTime() < sevenDaysFromNow)
      .sort((a, b) => new Date(a.next_likely_at) - new Date(b.next_likely_at));

    // Priority 2: recent captures (last 7 days), excluding those already in upcoming
    const upcomingIds = new Set(upcoming.map(e => e.id));
    const recent = entries
      .filter(e => !upcomingIds.has(e.id) && new Date(e.created_at).getTime() > sevenDaysAgo)
      .slice(0, 3);

    let cards = [];
    let label = '';

    if (upcoming.length) {
      cards = upcoming.slice(0, 3);
      label = `${upcoming.length} coming up this week`;
    } else if (recent.length) {
      cards = recent;
      label = `Met recently — review before you see them again`;
    } else {
      // Priority 3: just show the latest 2 as a memory nudge
      cards = entries.slice(0, 2);
      label = 'Recent people';
    }

    list.innerHTML = '';
    cards.forEach(e => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'tom-card';
      const whenLine = e.next_likely_at
        ? `Likely seeing them ${formatWhen(e.next_likely_at)}${e.next_likely_where ? ' · ' + escapeHtml(e.next_likely_where) : ''}`
        : `Met ${formatWhen(e.created_at)}${e.where_met ? ' · ' + escapeHtml(e.where_met) : ''}`;
      card.innerHTML = `
        <div class="tom-headline">${escapeHtml(e.headline || 'Someone you met')}</div>
        <div class="tom-when">${whenLine}</div>
      `;
      card.addEventListener('click', () => {
        // Tapping a card jumps to brief flow with the relevant place pre-filled
        const place = e.next_likely_where || e.where_met || '';
        go('brief');
        if (place) {
          briefWhere.value = place;
          setTimeout(() => btnBrief.click(), 50);
        }
      });
      list.appendChild(card);
    });

    sub.textContent = label;
    panel.hidden = false;
  } catch {
    /* silent — top-of-mind is a nice-to-have, not a critical path */
  }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-go]');
  if (t) go(t.dataset.go);
});

// ---------- iOS install hint ----------

function showInstallHintIfNeeded() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;
  if (isIOS && !isStandalone) {
    const loginHint = document.getElementById('install-hint');
    const homeHint = document.getElementById('home-install-hint');
    if (loginHint) loginHint.hidden = false;
    if (homeHint) homeHint.hidden = false;
  }
}

// ---------- auth ----------

function showLogin(errMsg) {
  currentUser = null;
  sessionToken = null;
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-login').classList.add('active');
  if (errMsg) flash(document.getElementById('login-status'), errMsg, 'error');
}

async function onSignedIn(session) {
  currentUser = session.user;
  sessionToken = session.access_token;

  // Make sure a profile row exists.
  await fetchAuth('/api/profile', { method: 'PUT', body: JSON.stringify({}) });

  // Migrate any legacy localStorage entries to the cloud (one-time, per browser).
  await maybeMigrateLegacy();

  // First-run onboarding for genuinely new users (no entries yet, hasn't dismissed).
  if (await shouldShowOnboarding()) {
    showOnboarding();
  } else {
    go('home');
  }
}

const ONBOARDING_DISMISSED_KEY = 'pocketSteve.onboarded.v1';

async function shouldShowOnboarding() {
  if (localStorage.getItem(ONBOARDING_DISMISSED_KEY)) return false;
  try {
    const r = await fetchAuth('/api/entries', { method: 'GET' });
    if (!r.ok) return false;
    const { entries } = await r.json();
    return !entries || entries.length === 0;
  } catch { return false; }
}

function showOnboarding() {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const view = document.getElementById('view-onboarding');
  view.classList.add('active');
  showOnboardStep(1);
}

function showOnboardStep(n) {
  document.querySelectorAll('#view-onboarding .onboard-stage').forEach(s => {
    s.hidden = (Number(s.dataset.step) !== n);
  });
}

document.getElementById('view-onboarding').addEventListener('click', (e) => {
  const action = e.target.closest('[data-onboard]')?.dataset.onboard;
  if (!action) return;
  if (action === 'next') {
    const current = Number(document.querySelector('#view-onboarding .onboard-stage:not([hidden])').dataset.step);
    showOnboardStep(current + 1);
  } else if (action === 'finish') {
    localStorage.setItem(ONBOARDING_DISMISSED_KEY, '1');
    go('home');
  }
});

document.getElementById('btn-login').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  if (!email) { flash(document.getElementById('login-status'), 'Type your email first.', 'error'); return; }
  const btn = document.getElementById('btn-login');
  btn.disabled = true; btn.textContent = 'Sending...';
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin }
    });
    if (error) throw error;
    flash(document.getElementById('login-status'),
      'Check your inbox. Tap the link in the email — it\'ll send you back here signed in.',
      'loading');
  } catch (err) {
    flash(document.getElementById('login-status'), err.message || 'Could not send link.', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Send magic link';
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await supabase.auth.signOut();
  showLogin();
});

async function fetchAuth(url, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (sessionToken) headers.Authorization = `Bearer ${sessionToken}`;
  const r = await fetch(url, { ...opts, headers });
  return r;
}

// ---------- legacy migration ----------

async function maybeMigrateLegacy() {
  let legacy = [];
  try { legacy = JSON.parse(localStorage.getItem(LEGACY_STORE_KEY)) || []; } catch {}
  if (!legacy.length) return;

  for (const e of legacy) {
    await fetchAuth('/api/entries', {
      method: 'POST',
      body: JSON.stringify({
        raw: e.raw || '',
        headline: e.headline,
        summary: e.summary,
        where_met: e.where,
        names: e.names || [],
        kids: e.kids || [],
        pets: e.pets || [],
        traits: e.traits || []
      })
    });
  }
  localStorage.removeItem(LEGACY_STORE_KEY);
  flash(document.getElementById('home-status'),
    `Migrated ${legacy.length} ${legacy.length === 1 ? 'person' : 'people'} from your old offline data to the cloud. Same names, same details, now safe.`,
    'loading');
}

// ---------- capture flow ----------

const captureInput = document.getElementById('capture-input');
const captureWhere = document.getElementById('capture-where');
const captureNextAt = document.getElementById('capture-next-at');
const captureNextWhere = document.getElementById('capture-next-where');
const captureResult = document.getElementById('capture-result');
const btnSave = document.getElementById('btn-save');
const btnMic = document.getElementById('btn-mic');
const micLabel = document.getElementById('mic-label');
const captureHint = document.getElementById('capture-hint');
const micCue = document.getElementById('mic-cue');
const listeningPane = document.getElementById('listening-pane');
const listeningTranscript = document.getElementById('listening-transcript');

// ---------- voice capture (browser-native SpeechRecognition) ----------

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isRecording = false;
let baselineText = '';
let interimText = '';

if (!SR) {
  // Older browser — keep the old "tap keyboard mic" hint
  btnMic.style.display = 'none';
  captureHint.innerHTML = 'Open <strong>Other ways to capture</strong> below and type or use your keyboard mic.';
  if (micCue) micCue.hidden = true;
} else {
  btnMic.addEventListener('click', toggleRecording);
}

function toggleRecording() {
  if (isRecording) stopRecording();
  else startRecording();
}

function startRecording() {
  if (!SR) return;
  try {
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    baselineText = captureInput.value.trim();
    if (baselineText && !baselineText.endsWith(' ')) baselineText += ' ';
    interimText = '';

    recognition.onstart = () => {
      isRecording = true;
      btnMic.classList.add('recording');
      micLabel.textContent = 'Listening — tap to stop';
      if (micCue) micCue.hidden = true;
      if (listeningPane) {
        listeningPane.hidden = false;
        listeningTranscript.textContent = baselineText.trim() || '';
        listeningTranscript.classList.remove('listening-empty');
        if (!listeningTranscript.textContent) {
          listeningTranscript.textContent = 'I\'ll show what I hear right here.';
          listeningTranscript.classList.add('listening-empty');
        }
      }
      if (navigator.vibrate) navigator.vibrate(8);
    };

    recognition.onresult = (e) => {
      let finalChunk = '';
      let interimChunk = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalChunk += r[0].transcript;
        else interimChunk += r[0].transcript;
      }
      if (finalChunk) {
        baselineText += finalChunk;
        if (!baselineText.endsWith(' ')) baselineText += ' ';
      }
      interimText = interimChunk;
      const combined = (baselineText + interimText).trim();
      captureInput.value = combined;
      if (listeningPane && !listeningPane.hidden) {
        listeningTranscript.textContent = combined || 'I\'ll show what I hear right here.';
        listeningTranscript.classList.toggle('listening-empty', !combined);
      }
    };

    recognition.onerror = (e) => {
      console.warn('SpeechRecognition error:', e.error);
      stopRecording();
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        captureHint.innerHTML = '<span style="color:var(--danger)">Microphone permission denied. Tap the mic on your keyboard instead, or grant mic access in iPhone Settings → Safari.</span>';
      }
    };

    recognition.onend = () => {
      // Some browsers stop recognition on silence — auto-restart while user is still recording
      if (isRecording) {
        try { recognition.start(); } catch {}
      }
    };

    recognition.start();
  } catch (err) {
    console.error('Could not start recognition', err);
    isRecording = false;
  }
}

function stopRecording() {
  isRecording = false;
  if (recognition) {
    try { recognition.stop(); } catch {}
    recognition = null;
  }
  btnMic.classList.remove('recording');
  micLabel.textContent = 'Tap and tell me';
  if (micCue) micCue.hidden = false;
  // Keep the listening pane visible briefly so the user sees what was captured
  // before it disappears when they hit Save (it's persistent until the next
  // recording starts).
  if (navigator.vibrate) navigator.vibrate([5, 30, 5]);
}

// ---------- photo capture (Gemini Vision) ----------

const photoInput = document.getElementById('capture-photo-input');
const photoPreview = document.getElementById('photo-preview');

photoInput.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  photoPreview.hidden = false;
  photoPreview.innerHTML = '<div class="loading">Compressing image...</div>';

  try {
    const compressed = await compressImage(file, 1280, 0.78);
    const previewUrl = URL.createObjectURL(compressed.blob);
    photoPreview.innerHTML = `
      <div class="photo-preview-card">
        <img src="${previewUrl}" alt="Photo" />
        <div class="photo-status loading">Reading the photo with Vision...</div>
      </div>
    `;

    const base64 = await blobToBase64(compressed.blob);
    const r = await fetch('/api/extract-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        imageBase64: base64,
        mimeType: compressed.mimeType,
        text: captureInput.value.trim() || ''
      })
    });
    if (!r.ok) throw new Error(await r.text());
    const parsed = await r.json();

    // Pre-fill the capture form with what Vision pulled out
    if (parsed.summary) {
      const existing = captureInput.value.trim();
      const incoming = parsed.summary;
      captureInput.value = existing
        ? `${existing}\n\n${incoming}`
        : incoming;
    } else if (parsed.raw_text) {
      const existing = captureInput.value.trim();
      captureInput.value = existing ? `${existing}\n\n${parsed.raw_text}` : parsed.raw_text;
    }
    if (parsed.where && !captureWhere.value.trim()) captureWhere.value = parsed.where;

    photoPreview.querySelector('.photo-status').className = 'photo-status';
    photoPreview.querySelector('.photo-status').innerHTML = parsed.summary
      ? `<strong>Got it:</strong> ${escapeHtml(parsed.headline || parsed.summary.slice(0, 80))}. Add a voice note below if you want, then save.`
      : `<strong>Read what I could.</strong> Add anything else by voice or text.`;
  } catch (err) {
    photoPreview.innerHTML = `<div class="error">Photo read failed: ${escapeHtml(err.message || '')}</div>`;
  } finally {
    e.target.value = ''; // allow re-selecting the same file
  }
});

async function compressImage(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height / width) * maxDim);
          width = maxDim;
        } else {
          width = Math.round((width / height) * maxDim);
          height = maxDim;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => blob ? resolve({ blob, mimeType: 'image/jpeg' }) : reject(new Error('Could not encode JPEG')),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')); };
    img.src = url;
  });
}

// ---------- LinkedIn enrich ----------

const linkedinUrlInput = document.getElementById('linkedin-url');
const linkedinTextInput = document.getElementById('linkedin-text');
const linkedinStatus = document.getElementById('linkedin-status');

document.getElementById('btn-enrich-linkedin').addEventListener('click', async () => {
  const url = linkedinUrlInput.value.trim();
  const text = linkedinTextInput.value.trim();
  if (!url && !text) {
    flash(linkedinStatus, 'Paste a LinkedIn URL or profile text first.', 'error');
    return;
  }
  const btn = document.getElementById('btn-enrich-linkedin');
  btn.disabled = true; btn.textContent = 'Reading...';
  flash(linkedinStatus, 'Reading the profile...', 'loading');
  try {
    const r = await fetch('/api/extract-linkedin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, text })
    });
    if (!r.ok) {
      const errBody = await r.text();
      try {
        const errJson = JSON.parse(errBody);
        if (errJson.error) throw new Error(errJson.error);
      } catch {}
      throw new Error(errBody);
    }
    const parsed = await r.json();

    // Pre-fill the capture form. Append rather than overwrite so existing voice
    // notes aren't lost.
    if (parsed.summary) {
      const existing = captureInput.value.trim();
      captureInput.value = existing ? `${existing}\n\n${parsed.summary}` : parsed.summary;
    }
    if (parsed.where && !captureWhere.value.trim()) captureWhere.value = parsed.where;

    flash(linkedinStatus, parsed.summary
      ? `Got it: ${parsed.headline || (parsed.summary || '').slice(0, 80)}. Added below — tap Save when ready.`
      : 'Read what I could (limited content). Add anything else by voice or text.',
      'loading');
  } catch (err) {
    flash(linkedinStatus, 'Could not read that profile. ' + (err.message || 'Try pasting the visible text instead.'), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Pull from LinkedIn';
  }
});

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result; // data:image/jpeg;base64,XXX
      const base64 = String(result).split(',')[1] || '';
      resolve(base64);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

btnSave.addEventListener('click', async () => {
  const text = captureInput.value.trim();
  const where = captureWhere.value.trim();
  if (!text) { flash(captureResult, 'Add a few words first — what did you notice?', 'error'); return; }

  btnSave.disabled = true;
  btnSave.textContent = 'Thinking...';
  captureResult.hidden = false;
  captureResult.innerHTML = '<div class="loading">Pulling out the details...</div>';

  try {
    // 1. Extract structured details via Gemini
    const ext = await fetch('/api/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, where })
    });
    if (!ext.ok) throw new Error(await ext.text());
    const parsed = await ext.json();

    // 2. Look for an existing person this might be a re-meeting of.
    const matchResp = await fetchAuth('/api/entries/match', {
      method: 'POST',
      body: JSON.stringify({
        headline: parsed.headline,
        summary: parsed.summary,
        where: where || parsed.where,
        names: parsed.names || [],
        kids: parsed.kids || [],
        pets: parsed.pets || []
      })
    });
    let match = null;
    if (matchResp.ok) {
      const j = await matchResp.json();
      if (j.match && (j.match.confidence === 'high' || j.match.confidence === 'medium')) {
        match = j.match;
      }
    }

    if (match) {
      // Pause on match — let user choose merge vs. new. This is a high-stakes
      // decision (wrong merge auto-creates confused timeline; wrong new just
      // creates a duplicate the user can clean up), so surface the evidence
      // prominently rather than burying it in muted italics.
      captureResult.innerHTML = '';
      const promptCard = document.createElement('div');
      promptCard.className = 'match-card';
      const confLabel = match.confidence === 'high' ? 'Strong match' : match.confidence === 'medium' ? 'Likely match' : 'Possible match';
      const metaBits = [];
      if (match.entry.where_met) metaBits.push(escapeHtml(match.entry.where_met));
      metaBits.push('first met ' + formatWhen(match.entry.created_at));
      promptCard.innerHTML = `
        <div class="match-card-eyebrow">${confLabel} &middot; same person?</div>
        <h3 class="match-card-headline">${escapeHtml(match.entry.headline || 'Someone you met before')}</h3>
        <div class="match-card-summary">${escapeHtml(match.entry.summary || '')}</div>
        <div class="match-card-meta">${metaBits.join(' &middot; ')}</div>
        <div class="match-card-evidence">
          <div class="match-card-evidence-label">Why I think it&rsquo;s the same person</div>
          <div class="match-card-evidence-body">${escapeHtml(match.reason || 'Multiple distinctive details overlap.')}</div>
        </div>
        <div class="match-card-actions">
          <button class="btn-primary" data-merge-action="attach">Yes, add to this person</button>
          <button class="link-button match-card-decline" data-merge-action="new">No, save as someone new</button>
        </div>
      `;
      captureResult.appendChild(promptCard);
      const handle = (e) => {
        const action = e.target.closest('[data-merge-action]')?.dataset.mergeAction;
        if (!action) return;
        promptCard.remove();
        finalizeSave(parsed, text, where, action === 'attach' ? match.entry.id : null);
      };
      promptCard.addEventListener('click', handle, { once: true });
      btnSave.disabled = false;
      btnSave.textContent = 'Save & extract';
      return;
    }

    // No match — save as new root entry.
    await finalizeSave(parsed, text, where, null);
  } catch (err) {
    flash(captureResult, 'Hmm, something went wrong saving that. ' + (err.message || ''), 'error');
    btnSave.disabled = false;
    btnSave.textContent = 'Save & extract';
  }
});

async function finalizeSave(parsed, text, where, parentId) {
  btnSave.disabled = true;
  btnSave.textContent = 'Saving...';
  captureResult.hidden = false;
  captureResult.innerHTML = '<div class="loading">Saving...</div>';
  try {
    const save = await fetchAuth('/api/entries', {
      method: 'POST',
      body: JSON.stringify({
        raw: text,
        headline: parsed.headline,
        summary: parsed.summary,
        where_met: where || parsed.where || 'Unspecified',
        names: parsed.names || [],
        kids: parsed.kids || [],
        pets: parsed.pets || [],
        traits: parsed.traits || [],
        next_likely_at: captureNextAt.value ? new Date(captureNextAt.value).toISOString() : null,
        next_likely_where: captureNextWhere.value.trim() || null,
        parent_id: parentId || null
      })
    });
    if (!save.ok) throw new Error(await save.text());
    const { entry } = await save.json();

    renderCaptureResult(entry, !!parentId);
    captureInput.value = '';
    captureNextAt.value = '';
    captureNextWhere.value = '';
    photoPreview.hidden = true;
    photoPreview.innerHTML = '';
  } catch (err) {
    flash(captureResult, 'Could not save: ' + (err.message || ''), 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = 'Save & extract';
  }
}

function renderCaptureResult(entry, mergedIntoExisting = false) {
  captureResult.hidden = false;
  // Hide the listening pane after save — the moment is over.
  if (listeningPane) listeningPane.hidden = true;

  const where = entry.where_met || 'Unspecified';
  const headline = mergedIntoExisting
    ? `Added another note to ${entry.headline ? '"' + escapeHtml(entry.headline) + '"' : 'this person'}.`
    : `Saved to your memory.`;

  // Build the "what happens next" block so the user knows where this lives.
  const nextLines = [];
  if (entry.where_met) {
    nextLines.push(`I&rsquo;ll bring them up next time you say <em>&ldquo;Heading to ${escapeHtml(entry.where_met)}&rdquo;</em>.`);
  }
  if (entry.next_likely_at) {
    const dt = new Date(entry.next_likely_at);
    nextLines.push(`I&rsquo;ll surface them on your home screen the week of ${formatWhen(entry.next_likely_at)}, and remind you 30 min before.`);
  } else if (entry.where_met) {
    nextLines.push(`If you connect your calendar, I&rsquo;ll auto-remind you 30 min before any event matching <em>${escapeHtml(entry.where_met)}</em>.`);
  }

  captureResult.innerHTML = `
    <div class="save-confirmation">
      <div class="save-check" aria-hidden="true">✓</div>
      <h3 class="save-headline">${headline}</h3>
    </div>
  `;

  const card = entryCard(entry);
  card.querySelector('.actions-row').appendChild(buildCalendarChip(entry));
  captureResult.appendChild(card);

  if (nextLines.length) {
    const next = document.createElement('div');
    next.className = 'save-next';
    next.innerHTML = `
      <div class="save-next-label">Here&rsquo;s when you&rsquo;ll see them again</div>
      <ul>${nextLines.map(l => `<li>${l}</li>`).join('')}</ul>
    `;
    captureResult.appendChild(next);
  }

  const actions = document.createElement('div');
  actions.className = 'save-actions';
  actions.innerHTML = `
    <button class="btn-secondary" data-go="home">Back to home</button>
    <button class="btn-tertiary" data-go="library">See everyone</button>
  `;
  captureResult.appendChild(actions);
}

// ---------- briefing flow ----------

const briefWhere = document.getElementById('brief-where');
const briefResult = document.getElementById('brief-result');
const btnBrief = document.getElementById('btn-brief');

btnBrief.addEventListener('click', async () => {
  const where = briefWhere.value.trim();
  if (!where) { flash(briefResult, "Type where you're heading first.", 'error'); return; }

  btnBrief.disabled = true;
  btnBrief.textContent = 'Thinking...';
  // Friendly multi-stage loading copy so the user sees Steve "doing something"
  // rather than a generic spinner.
  briefResult.innerHTML = `
    <div class="brief-thinking">
      <div class="brief-thinking-dot"></div>
      <div class="brief-thinking-text" id="brief-thinking-text">Looking through who you&rsquo;ve met at <strong>${escapeHtml(where)}</strong>&hellip;</div>
    </div>
  `;
  // Swap the copy at ~1.2s so it feels like Steve is reasoning, not stalled
  setTimeout(() => {
    const t = document.getElementById('brief-thinking-text');
    if (t) t.innerHTML = `Pulling out what&rsquo;ll spark your memory&hellip;`;
  }, 1200);

  try {
    const r = await fetchAuth('/api/entries', { method: 'GET' });
    if (!r.ok) throw new Error(await r.text());
    const { entries } = await r.json();
    if (!entries.length) {
      briefResult.innerHTML = `
        <div class="brief-empty">
          <div class="brief-empty-icon" aria-hidden="true">·</div>
          <div class="brief-empty-headline">Nothing to bring to mind yet.</div>
          <div class="brief-empty-body">Capture someone first — talk into the mic, snap a card, drop a LinkedIn URL. Steve starts working the moment you do.</div>
          <button class="btn-primary" data-go="capture" style="margin-top:14px;">+ Just met someone</button>
        </div>
      `;
      return;
    }

    // Briefing call still uses Gemini directly; pass entries (already RLS-scoped)
    const compact = entries.map(e => ({
      id: e.id,
      where: e.where_met,
      headline: e.headline,
      summary: e.summary,
      raw: e.raw,
      createdAt: e.created_at
    }));

    const b = await fetch('/api/brief', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ where, entries: compact })
    });
    if (!b.ok) throw new Error(await b.text());
    const { matches } = await b.json();
    if (!matches || matches.length === 0) {
      briefResult.innerHTML = `
        <div class="brief-empty">
          <div class="brief-empty-icon" aria-hidden="true">·</div>
          <div class="brief-empty-headline">No matches at <em>${escapeHtml(where)}</em> yet.</div>
          <div class="brief-empty-body">Try a different place, or come back after you&rsquo;ve captured a few people there.</div>
        </div>
      `;
      return;
    }

    briefResult.innerHTML = '';
    matches.forEach(m => {
      const original = entries.find(e => e.id === m.id) || m;
      const briefingText = m.briefing || original.summary || '';
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="where">${escapeHtml(original.where_met || '')}</div>
        <h3>${escapeHtml(original.headline || 'Someone you met')}</h3>
        <div class="summary">${escapeHtml(briefingText)}</div>
        <div class="meta">${formatWhen(original.created_at)}</div>
        <div class="actions-row">
          <button class="chip speak-btn" type="button">🔊 Read aloud</button>
        </div>
      `;
      const speakBtn = card.querySelector('.speak-btn');
      speakBtn.addEventListener('click', () => speakBriefing(briefingText, speakBtn));
      briefResult.appendChild(card);
    });
  } catch (err) {
    flash(briefResult, "Couldn't pull the briefing. " + (err.message || ''), 'error');
  } finally {
    btnBrief.disabled = false;
    btnBrief.textContent = 'Pull up the people';
  }
});

// ---------- library ----------

async function renderLibrary() {
  const list = document.getElementById('library-list');
  const tag = document.getElementById('library-tag');
  list.innerHTML = '<div class="loading">Loading...</div>';
  if (tag) tag.innerHTML = '&nbsp;';
  const r = await fetchAuth('/api/entries', { method: 'GET' });
  if (!r.ok) { list.innerHTML = '<div class="error">Could not load.</div>'; return; }
  const { entries } = await r.json();
  refreshPlacesDatalist(entries);
  if (!entries.length) {
    list.innerHTML = `
      <div class="brief-empty">
        <div class="brief-empty-icon" aria-hidden="true">·</div>
        <div class="brief-empty-headline">Nobody yet.</div>
        <div class="brief-empty-body">After your first capture, this is where every person you&rsquo;ve met lives. Lighter than a contact list. Closer to a memory.</div>
        <button class="btn-primary" data-go="capture" style="margin-top:14px;">+ Just met someone</button>
      </div>
    `;
    return;
  }
  if (tag) {
    const totalNotes = entries.reduce((sum, e) => sum + (e.note_count || 0), 0);
    const peopleLabel = entries.length === 1 ? 'person' : 'people';
    let line = `${entries.length} ${peopleLabel} remembered`;
    if (totalNotes) {
      const noteLabel = totalNotes === 1 ? 'follow-up note' : 'follow-up notes';
      line += ` · ${totalNotes} ${noteLabel}`;
    }
    tag.textContent = line;
  }
  list.innerHTML = '';
  entries.forEach(e => list.appendChild(entryCard(e)));
}

function entryCard(entry) {
  const div = document.createElement('div');
  div.className = 'card';
  div.dataset.entryId = entry.id;
  renderCardView(div, entry);
  return div;
}

function renderCardView(div, entry) {
  const noteCount = entry.note_count || 0;
  const noteBadge = noteCount > 0
    ? `<span class="note-badge" title="${noteCount} additional note${noteCount === 1 ? '' : 's'}">+${noteCount} note${noteCount === 1 ? '' : 's'}</span>`
    : '';
  const lastSeen = entry.last_seen && entry.last_seen !== entry.created_at
    ? ` · last seen ${formatWhen(entry.last_seen)}`
    : '';
  div.innerHTML = `
    <div class="where">${escapeHtml(entry.where_met || '')} ${noteBadge}</div>
    <h3>${escapeHtml(entry.headline || 'Someone you met')}</h3>
    <div class="summary">${escapeHtml(entry.summary || '')}</div>
    <div class="meta">First met ${formatWhen(entry.created_at)}${lastSeen}</div>
    <div class="actions-row">
      ${noteCount > 0 ? '<button class="chip" data-action="timeline">Show timeline</button>' : ''}
      <button class="chip" data-action="edit">Edit</button>
      <button class="chip chip-danger" data-action="delete">Delete</button>
    </div>
    <div class="timeline" hidden></div>
  `;
  div.querySelector('[data-action="edit"]').addEventListener('click', () => renderCardEdit(div, entry));
  div.querySelector('[data-action="delete"]').addEventListener('click', () => deleteEntry(div, entry));
  const tlBtn = div.querySelector('[data-action="timeline"]');
  if (tlBtn) tlBtn.addEventListener('click', () => loadTimeline(div, entry, tlBtn));
}

async function loadTimeline(div, entry, btn) {
  const tl = div.querySelector('.timeline');
  if (!tl.hidden) {
    tl.hidden = true;
    btn.textContent = 'Show timeline';
    return;
  }
  btn.textContent = 'Loading...';
  try {
    const r = await fetchAuth(`/api/entries?id=${encodeURIComponent(entry.id)}&include=children`);
    if (!r.ok) throw new Error(await r.text());
    const { thread } = await r.json();
    if (!thread || !thread.length) { tl.innerHTML = '<div class="empty">No timeline yet.</div>'; tl.hidden = false; btn.textContent = 'Hide timeline'; return; }

    tl.innerHTML = thread.map((t, i) => `
      <div class="tl-item${i === 0 ? ' tl-root' : ''}">
        <div class="tl-when">${formatWhen(t.created_at)}${t.where_met ? ' · ' + escapeHtml(t.where_met) : ''}</div>
        <div class="tl-body">${escapeHtml(t.summary || t.raw || '')}</div>
      </div>
    `).join('');
    tl.hidden = false;
    btn.textContent = 'Hide timeline';
  } catch (err) {
    tl.innerHTML = `<div class="error">Could not load timeline: ${escapeHtml(err.message || '')}</div>`;
    tl.hidden = false;
    btn.textContent = 'Hide timeline';
  }
}

function renderCardEdit(div, entry) {
  div.innerHTML = `
    <div class="row" style="margin-top:0;">
      <label>Where you met</label>
      <input type="text" data-field="where_met" value="${escapeAttr(entry.where_met || '')}" />
    </div>
    <div class="row">
      <label>Headline</label>
      <input type="text" data-field="headline" value="${escapeAttr(entry.headline || '')}" />
    </div>
    <div class="row">
      <label>Summary</label>
      <textarea data-field="summary" rows="4">${escapeHtml(entry.summary || '')}</textarea>
    </div>
    <div class="actions-row">
      <button class="chip chip-primary" data-action="save">Save changes</button>
      <button class="chip" data-action="cancel">Cancel</button>
    </div>
    <div class="card-status" hidden></div>
  `;
  div.querySelector('[data-action="cancel"]').addEventListener('click', () => renderCardView(div, entry));
  div.querySelector('[data-action="save"]').addEventListener('click', () => saveCardEdit(div, entry));
}

async function saveCardEdit(div, entry) {
  const patch = {};
  div.querySelectorAll('[data-field]').forEach(el => {
    patch[el.dataset.field] = el.value.trim() || null;
  });
  const status = div.querySelector('.card-status');
  status.hidden = false;
  status.innerHTML = '<div class="loading">Saving...</div>';
  try {
    const r = await fetchAuth(`/api/entries?id=${encodeURIComponent(entry.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch)
    });
    if (!r.ok) throw new Error(await r.text());
    const { entry: updated } = await r.json();
    renderCardView(div, updated);
  } catch (err) {
    status.innerHTML = `<div class="error">Save failed: ${escapeHtml(err.message || '')}</div>`;
  }
}

async function deleteEntry(div, entry) {
  if (!confirm(`Delete "${entry.headline || 'this person'}" from Steve? Can't undo.`)) return;
  try {
    const r = await fetchAuth(`/api/entries?id=${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(await r.text());
    div.style.transition = 'opacity .2s, transform .2s';
    div.style.opacity = '0';
    div.style.transform = 'scale(0.98)';
    setTimeout(() => div.remove(), 200);
  } catch (err) {
    alert('Delete failed: ' + (err.message || ''));
  }
}

// ---------- read-aloud (browser speechSynthesis) ----------
//
// Auditory + visual encoding > visual alone (dual coding theory). Tap a card
// to hear the briefing in your earbuds while you walk into the event — small
// step toward the v3 ambient-voice vision. Tap again to stop.

function speakBriefing(text, btn) {
  if (!('speechSynthesis' in window)) {
    btn.textContent = '🔇 unsupported';
    btn.disabled = true;
    return;
  }
  const synth = window.speechSynthesis;
  if (synth.speaking || synth.pending) {
    synth.cancel();
    btn.textContent = '🔊 Read aloud';
    return;
  }
  const utt = new SpeechSynthesisUtterance(text);
  utt.rate = 1.0;
  utt.pitch = 1.0;
  utt.volume = 1.0;
  utt.lang = 'en-US';
  utt.onend = () => { btn.textContent = '🔊 Read aloud'; };
  utt.onerror = () => { btn.textContent = '🔇 read failed'; setTimeout(() => { btn.textContent = '🔊 Read aloud'; }, 1500); };
  btn.textContent = '⏸ Stop';
  synth.speak(utt);
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}

// ---------- settings ----------

async function renderSettings() {
  const emailEl = document.getElementById('settings-email');
  const urlInput = document.getElementById('settings-calendar-url');
  const msSub = document.getElementById('ms-sub');
  const btnConnect = document.getElementById('btn-connect-ms');
  const btnDisconnect = document.getElementById('btn-disconnect-ms');
  const anonPill = document.getElementById('settings-anon-pill');
  const claimBlock = document.getElementById('settings-claim');

  // Anonymous users don't have an email; show the claim/upgrade flow instead.
  const isAnon = !!currentUser?.is_anonymous;
  if (isAnon) {
    emailEl.textContent = 'Anonymous account';
    if (anonPill) anonPill.hidden = false;
    if (claimBlock) claimBlock.hidden = false;
  } else {
    emailEl.textContent = currentUser?.email || '—';
    if (anonPill) anonPill.hidden = true;
    if (claimBlock) claimBlock.hidden = true;
  }
  urlInput.value = '';

  // Surface OAuth callback flags from the URL (set by /api/oauth/microsoft/callback)
  const hashParams = new URLSearchParams(location.search);
  if (hashParams.get('oauthConnected')) {
    flash(document.getElementById('settings-status'), 'Outlook connected. I\'ll start scanning your calendar daily.', 'loading');
    history.replaceState({}, '', location.pathname);
  } else if (hashParams.get('oauthError')) {
    flash(document.getElementById('settings-status'), 'Could not connect: ' + hashParams.get('oauthError'), 'error');
    history.replaceState({}, '', location.pathname);
  }

  try {
    const r = await fetchAuth('/api/profile', { method: 'GET' });
    if (r.ok) {
      const { profile, microsoft } = await r.json();
      if (profile?.calendar_ics_url) urlInput.value = profile.calendar_ics_url;

      if (microsoft) {
        msSub.textContent = `Connected as ${microsoft.email || 'your Outlook account'}.`;
        btnConnect.hidden = true;
        btnDisconnect.hidden = false;
      } else {
        msSub.textContent = 'One-click. Read-only access to your calendar.';
        btnConnect.hidden = false;
        btnDisconnect.hidden = true;
      }
    }
  } catch {}
}

document.getElementById('btn-connect-ms').addEventListener('click', async () => {
  const status = document.getElementById('settings-status');
  flash(status, 'Redirecting to Microsoft...', 'loading');
  try {
    const r = await fetchAuth('/api/oauth/microsoft?action=start', { method: 'GET' });
    if (!r.ok) throw new Error(await r.text());
    const { authorizeUrl } = await r.json();
    window.location.href = authorizeUrl;
  } catch (err) {
    flash(status, 'Could not start sign-in. ' + (err.message || ''), 'error');
  }
});

document.getElementById('btn-send-invite').addEventListener('click', async () => {
  const status = document.getElementById('invite-status');
  const emailEl = document.getElementById('invite-email');
  const nameEl = document.getElementById('invite-name');
  const messageEl = document.getElementById('invite-message');
  const email = emailEl.value.trim();
  if (!email) { flash(status, 'Type their email first.', 'error'); return; }
  if (!/.+@.+\..+/.test(email)) { flash(status, "That doesn't look like a valid email.", 'error'); return; }

  const btn = document.getElementById('btn-send-invite');
  btn.disabled = true; btn.textContent = 'Generating link...';
  flash(status, 'Generating their one-tap sign-in link...', 'loading');
  try {
    const r = await fetchAuth('/api/invite', {
      method: 'POST',
      body: JSON.stringify({
        email,
        name: nameEl.value.trim(),
        message: messageEl.value.trim()
      })
    });
    if (!r.ok) throw new Error(await r.text());
    const { recipientEmail, subject, body } = await r.json();

    // Open the user's mail app prefilled — they review and hit Send.
    // This way the email comes from their actual address (more personal,
    // higher trust) and we sidestep any deliverability hassles.
    const mailto = `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;

    flash(status, `Your mail app should have opened with the email pre-written. Just hit send. ${recipientEmail} will get a one-tap sign-in link.`, 'loading');
    emailEl.value = '';
    nameEl.value = '';
    messageEl.value = '';
  } catch (err) {
    flash(status, 'Could not generate link: ' + (err.message || ''), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send sign-in link';
  }
});

// Claim an anonymous account by attaching an email. Supabase's updateUser
// preserves the user_id (and therefore all their entries) — they just gain
// the ability to sign in on other devices via magic link to the same account.
document.getElementById('btn-claim-account').addEventListener('click', async () => {
  const status = document.getElementById('settings-claim-status');
  const emailEl = document.getElementById('settings-claim-email');
  const email = emailEl.value.trim();
  if (!email || !/.+@.+\..+/.test(email)) {
    status.textContent = 'Type a valid email first.';
    status.style.color = 'var(--danger)';
    return;
  }
  const btn = document.getElementById('btn-claim-account');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  status.style.color = 'var(--muted)';
  status.textContent = 'Saving...';
  try {
    const { error } = await supabase.auth.updateUser({ email });
    if (error) throw error;
    status.textContent = `Sent. Check ${email} and tap the confirmation link to lock it in. Until you do, you stay signed in here.`;
    status.style.color = 'var(--text)';
  } catch (err) {
    status.style.color = 'var(--danger)';
    status.textContent = 'Could not save: ' + (err.message || 'unknown error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save my account';
  }
});

document.getElementById('btn-disconnect-ms').addEventListener('click', async () => {
  if (!confirm('Disconnect Outlook? I\'ll stop scanning your calendar until you reconnect.')) return;
  const status = document.getElementById('settings-status');
  flash(status, 'Disconnecting...', 'loading');
  try {
    const r = await fetchAuth('/api/oauth/microsoft?action=disconnect', { method: 'POST' });
    if (!r.ok) throw new Error(await r.text());
    flash(status, 'Outlook disconnected.', 'loading');
    renderSettings();
  } catch (err) {
    flash(status, 'Disconnect failed. ' + (err.message || ''), 'error');
  }
});

document.getElementById('btn-save-calendar').addEventListener('click', async () => {
  const status = document.getElementById('settings-status');
  const url = document.getElementById('settings-calendar-url').value.trim();
  flash(status, 'Saving...', 'loading');
  try {
    const r = await fetchAuth('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ calendar_ics_url: url || null })
    });
    if (!r.ok) throw new Error(await r.text());
    flash(status, url ? 'Saved. I\'ll check your calendar daily.' : 'Cleared. No calendar nudges.', 'loading');
  } catch (err) {
    flash(status, 'Could not save. ' + (err.message || ''), 'error');
  }
});

// ---------- calendar nudge (manual chip — fallback if user hasn't set ICS) ----------

function buildCalendarChip(entry) {
  const a = document.createElement('a');
  a.className = 'chip';
  a.textContent = entry.next_likely_at ? '+ Add reminder to my calendar' : '+ Remind me before next time';
  a.href = buildIcsDataUrl(entry);
  a.download = `steve-${(entry.where_met || 'reminder').replace(/\s+/g,'-').toLowerCase()}.ics`;
  return a;
}

function buildIcsDataUrl(entry) {
  let dt;
  if (entry.next_likely_at) {
    dt = new Date(entry.next_likely_at);
  } else {
    dt = new Date();
    dt.setDate(dt.getDate() + 1);
    dt.setHours(9, 0, 0, 0);
  }
  const dtEnd = new Date(dt.getTime() + 30 * 60000);

  const fmt = (d) => d.toISOString().replace(/[-:]/g,'').replace(/\.\d+/, '');
  const summary = `Steve: ${entry.next_likely_where || entry.where_met || 'briefing'}`;
  const description = (entry.summary || entry.raw || '').replace(/\n/g,'\\n');
  const url = `${location.origin}/?brief=${encodeURIComponent(entry.where_met || '')}`;

  const ics = [
    'BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Steve//EN','CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${entry.id}@steve`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(dt)}`,
    `DTEND:${fmt(dtEnd)}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}\\n\\nOpen briefing: ${url}`,
    `URL:${url}`,
    'BEGIN:VALARM','TRIGGER:-PT30M','ACTION:DISPLAY',`DESCRIPTION:${summary}`,'END:VALARM',
    'END:VEVENT','END:VCALENDAR'
  ].join('\r\n');

  return 'data:text/calendar;charset=utf-8,' + encodeURIComponent(ics);
}

// ---------- helpers ----------

function flash(el, msg, kind) {
  if (!el) return;
  el.hidden = false;
  el.innerHTML = `<div class="${kind || 'loading'}">${escapeHtml(msg)}</div>`;
}

function formatWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]
  ));
}

// ---------- deep links (calendar reminder, iOS Shortcut, share sheet) ----------
//
// Supported URL params (all optional):
//   ?brief=<place>           — open briefing for that place, auto-run
//   ?action=capture          — open capture screen, focus mic (Shortcut entry)
//   ?action=brief            — open briefing screen
//   ?text=<voice memo>       — pre-fill capture textarea (Shortcut entry from
//                              "Hey Siri, capture for Steve <text>" or share sheet)
//   ?where=<place>           — pre-fill the "where" field on capture
//
// Example iOS Shortcut: "Steve me" -> URL "https://memory-trigger.vercel.app/
// ?action=capture" -> Open in Safari. One Siri command, two taps to save.

(function handleDeepLink() {
  const params = new URLSearchParams(location.search);
  const brief = params.get('brief');
  const action = params.get('action');
  const text = params.get('text');
  const where = params.get('where');

  function applyOnLogin() {
    if (!currentUser) return;
    if (brief) {
      go('brief');
      briefWhere.value = brief;
      setTimeout(() => btnBrief.click(), 50);
      return;
    }
    if (action === 'capture' || text || where) {
      go('capture');
      if (text) captureInput.value = text;
      if (where) captureWhere.value = where;
      setTimeout(() => {
        if (text || where) {
          // Pre-filled — focus Save instead of mic so they can review and tap save
          captureInput.focus();
        } else {
          // No content yet — focus the mic so one more tap captures
          if (btnMic && !btnMic.hidden) btnMic.focus();
        }
      }, 100);
      return;
    }
    if (action === 'brief') {
      go('brief');
      if (where) {
        briefWhere.value = where;
        setTimeout(() => btnBrief.click(), 50);
      }
    }
  }

  // Wait briefly for the auth handshake to complete before navigating.
  setTimeout(applyOnLogin, 800);
})();

// ---------- service worker ----------

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {});
  });
}
