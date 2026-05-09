// Multi-model routing layer.
//
// Each endpoint calls `complete({ task, system, user, json, ... })` and gets
// a text or parsed-JSON response back. The router decides which model
// provider to use based on env-configured priority lists per task, and
// transparently falls back to the next provider if one errors.
//
// Per-task routing via env vars:
//   MODEL_BRIEF       — provider order for /api/brief (e.g. "anthropic,gemini")
//   MODEL_EXTRACT     — for /api/extract
//   MODEL_MATCH       — for /api/entries/match
//   MODEL_PHOTO       — for /api/extract-photo (must be a vision-capable provider)
//   MODEL_LINKEDIN    — for /api/extract-linkedin
//   MODEL_CALENDAR    — for /api/calendar-scan event matching
//   MODEL_DEFAULT     — fallback for any task without a specific override
//
// Defaults (when no env override): Gemini 2.5 Flash for everything.
//
// Quality-routing recipe: set `MODEL_BRIEF=anthropic,gemini` to use Claude
// for the user-facing memory-trigger prose with Gemini as fallback.
// Cost-routing recipe: keep MODEL_EXTRACT=gemini for the high-volume
// extraction call; only upgrade the user-visible briefing.

const ADAPTERS = {
  gemini: geminiComplete,
  anthropic: anthropicComplete,
  openai: openaiComplete,
  cerebras: cerebrasComplete
};

const HAS_KEY = {
  gemini: () => !!process.env.GEMINI_API_KEY,
  anthropic: () => !!process.env.ANTHROPIC_API_KEY,
  openai: () => !!process.env.OPENAI_API_KEY,
  cerebras: () => !!process.env.CEREBRAS_API_KEY
};

const DEFAULTS_BY_TASK = {
  brief: 'anthropic,gemini',                 // user-facing prose: Claude if available
  extract: 'cerebras,gemini',                // high-volume + text-only: fast Llama wins when free
  match: 'cerebras,gemini,openai',           // judgment task; text-only — pick fast
  photo: 'gemini,openai',                    // vision required; Cerebras has no vision today
  linkedin: 'cerebras,gemini,anthropic',     // text-only after HTML strip
  calendar: 'cerebras,gemini',               // batch cron, latency-tolerant but free fast > free slow
  default: 'gemini'
};

export async function complete(opts) {
  const task = opts.task || 'default';
  const order = providerOrder(task);
  let lastErr;
  for (const name of order) {
    if (!ADAPTERS[name]) continue;
    if (!HAS_KEY[name]()) continue;
    try {
      return await ADAPTERS[name](opts);
    } catch (err) {
      lastErr = err;
      console.warn(`[_models] task=${task} provider=${name} failed: ${err.message}. Trying next.`);
    }
  }
  throw lastErr || new Error(`No usable model provider for task=${task} (set GEMINI_API_KEY at minimum)`);
}

function providerOrder(task) {
  const env = process.env[`MODEL_${task.toUpperCase()}`];
  if (env) return env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const fallback = process.env.MODEL_DEFAULT || DEFAULTS_BY_TASK[task] || DEFAULTS_BY_TASK.default;
  return fallback.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// ====================================================================
//  Adapters
// ====================================================================
//
// Common shape:
//   complete({
//     task, system, user, json,        // task = string label, system = string, user = string OR array of parts (for vision)
//     temperature = 0.2, maxTokens = 800,
//     model                            // optional override of default model id for this provider
//   }) -> string (text) or object (when json=true)

// ----- Gemini -----

async function geminiComplete({ system, user, json, temperature = 0.2, maxTokens = 800, model = 'gemini-2.5-flash' }) {
  const apiKey = process.env.GEMINI_API_KEY;
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const parts = Array.isArray(user) ? user : [{ text: user }];
  const body = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature,
      maxOutputTokens: maxTokens,
      ...(json ? { responseMimeType: 'application/json' } : {})
    }
  };
  const r = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`gemini ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return json ? safeJson(text) : text;
}

// ----- Anthropic Claude -----

async function anthropicComplete({ system, user, json, temperature = 0.2, maxTokens = 800, model = 'claude-haiku-4-5-20251001' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  // Convert user-as-parts (vision arrays) to Anthropic content blocks if needed.
  const content = Array.isArray(user)
    ? user.map(p => {
        if (p.text) return { type: 'text', text: p.text };
        if (p.inlineData) return {
          type: 'image',
          source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data }
        };
        return null;
      }).filter(Boolean)
    : [{ type: 'text', text: user }];

  // For JSON-shaped tasks we ask for JSON via system prompt + nudge in user prompt.
  // (Claude doesn't have a strict response_mime_type knob the way Gemini does.)
  const sys = json ? `${system}\n\nReturn ONLY valid JSON. No prose, no markdown fences.` : system;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature,
      system: sys,
      messages: [{ role: 'user', content }]
    })
  });
  if (!r.ok) throw new Error(`anthropic ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data.content?.find(b => b.type === 'text')?.text || '';
  if (!json) return text;
  // Strip ```json fences if Claude added them
  const clean = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  return safeJson(clean);
}

// ----- OpenAI -----

async function openaiComplete({ system, user, json, temperature = 0.2, maxTokens = 800, model = 'gpt-4o-mini' }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const messages = [{ role: 'system', content: system }];

  if (Array.isArray(user)) {
    // Vision content: text + image_url parts (OpenAI format)
    const content = user.map(p => {
      if (p.text) return { type: 'text', text: p.text };
      if (p.inlineData) return {
        type: 'image_url',
        image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
      };
      return null;
    }).filter(Boolean);
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: user });
  }

  const body = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {})
  };

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`openai ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || '';
  return json ? safeJson(text) : text;
}

// ----- Cerebras (Llama on Cerebras CS-3 — fastest free-tier inference) -----
//
// OpenAI-compatible chat API. No vision support today (text-only). Perfect
// for the high-volume `extract` and `match` tasks where latency dominates.
// Default model: llama-3.3-70b (best free quality). Override with `model`.

async function cerebrasComplete({ system, user, json, temperature = 0.2, maxTokens = 800, model = 'llama-3.3-70b' }) {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (Array.isArray(user)) {
    // Cerebras text-only — strip image parts and concatenate text.
    user = user.filter(p => p.text).map(p => p.text).join('\n\n');
    if (!user) throw new Error('cerebras: no text content (vision not supported)');
  }
  const body = {
    model,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    temperature,
    max_tokens: maxTokens,
    ...(json ? { response_format: { type: 'json_object' } } : {})
  };
  const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`cerebras ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || '';
  return json ? safeJson(text) : text;
}

// ====================================================================
//  Helpers
// ====================================================================

function safeJson(text) {
  if (!text) return {};
  const clean = String(text).replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  try { return JSON.parse(clean); }
  catch (e) {
    const err = new Error(`Model returned non-JSON: ${e.message}`);
    err.raw = clean.slice(0, 500);
    throw err;
  }
}

// Public helper so callers can detect available providers (e.g. for UI hints).
export function availableProviders() {
  return Object.keys(ADAPTERS).filter(name => HAS_KEY[name]());
}
