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
//   MODEL_CALENDAR    — for /api/calendar-scan event matching
//   MODEL_DEFAULT     — fallback for any task without a specific override
//
// Defaults (when no env override): see DEFAULTS_BY_TASK below.
//
// Quality-routing recipe: set `MODEL_BRIEF=anthropic,gemini` to use Claude
// for the user-facing memory-trigger prose with Gemini as fallback.
// Cost-routing recipe: keep MODEL_EXTRACT=cerebras,gemini for the high-volume
// extraction call; Cerebras runs Llama 3.3 70B at sub-second latency for free.

const ADAPTERS = {
  // First-party adapters (each provider's own native API)
  gemini: geminiComplete,
  anthropic: anthropicComplete,
  // OpenAI-compatible chat APIs (most modern providers expose this)
  openai:     (opts) => openaiCompatible(opts, OPENAI),
  cerebras:   (opts) => openaiCompatible(opts, CEREBRAS),
  groq:       (opts) => openaiCompatible(opts, GROQ),
  deepseek:   (opts) => openaiCompatible(opts, DEEPSEEK),
  mistral:    (opts) => openaiCompatible(opts, MISTRAL),
  kimi:       (opts) => openaiCompatible(opts, KIMI),
  perplexity: (opts) => openaiCompatible(opts, PERPLEXITY),
  xai:        (opts) => openaiCompatible(opts, XAI)
};

const HAS_KEY = {
  gemini:     () => !!process.env.GEMINI_API_KEY,
  anthropic:  () => !!process.env.ANTHROPIC_API_KEY,
  openai:     () => !!process.env.OPENAI_API_KEY,
  cerebras:   () => !!process.env.CEREBRAS_API_KEY,
  groq:       () => !!process.env.GROQ_API_KEY,
  deepseek:   () => !!process.env.DEEPSEEK_API_KEY,
  mistral:    () => !!process.env.MISTRAL_API_KEY,
  kimi:       () => !!process.env.KIMI_API_KEY || !!process.env.MOONSHOT_API_KEY,
  perplexity: () => !!process.env.PERPLEXITY_API_KEY,
  xai:        () => !!process.env.XAI_API_KEY
};

// Provider configs for OpenAI-compatible endpoints.
// `vision: true` means the provider can accept image parts (inlineData).
const OPENAI = {
  label: 'openai',
  baseUrl: 'https://api.openai.com/v1',
  authEnv: 'OPENAI_API_KEY',
  defaultModel: 'gpt-4o-mini',
  jsonMode: 'response_format', // standard OpenAI JSON mode
  vision: true
};
const CEREBRAS = {
  label: 'cerebras',
  baseUrl: 'https://api.cerebras.ai/v1',
  authEnv: 'CEREBRAS_API_KEY',
  defaultModel: 'llama-3.3-70b',
  jsonMode: 'response_format',
  vision: false
};
const GROQ = {
  label: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  authEnv: 'GROQ_API_KEY',
  defaultModel: 'llama-3.3-70b-versatile',
  jsonMode: 'response_format',
  vision: false
};
const DEEPSEEK = {
  label: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  authEnv: 'DEEPSEEK_API_KEY',
  defaultModel: 'deepseek-chat',
  jsonMode: 'response_format',
  vision: false
};
const MISTRAL = {
  label: 'mistral',
  baseUrl: 'https://api.mistral.ai/v1',
  authEnv: 'MISTRAL_API_KEY',
  defaultModel: 'mistral-small-latest',
  jsonMode: 'response_format',
  vision: false
};
const KIMI = {
  // Kimi K2 from Moonshot AI. The international endpoint is api.moonshot.ai;
  // the .cn endpoint also exists for China region. Either env var works.
  label: 'kimi',
  baseUrl: 'https://api.moonshot.ai/v1',
  authEnv: ['KIMI_API_KEY', 'MOONSHOT_API_KEY'],
  defaultModel: 'moonshot-v1-32k',
  jsonMode: 'response_format',
  vision: false
};
const PERPLEXITY = {
  // Perplexity's Sonar models include built-in web search — useful for tasks
  // where current web context matters (kept for future person-research use;
  // not currently wired to any production task).
  label: 'perplexity',
  baseUrl: 'https://api.perplexity.ai',
  authEnv: 'PERPLEXITY_API_KEY',
  defaultModel: 'sonar',
  jsonMode: 'response_format',
  vision: false
};
const XAI = {
  label: 'xai',
  baseUrl: 'https://api.x.ai/v1',
  authEnv: 'XAI_API_KEY',
  defaultModel: 'grok-4',
  jsonMode: 'response_format',
  vision: true
};

const DEFAULTS_BY_TASK = {
  // user-facing prose: prefer Claude (warm), fall through to high-quality models, end with free Gemini
  brief:    'anthropic,kimi,deepseek,gemini',
  // high-volume + text-only: fastest free inference first, then quality, then guaranteed-free Gemini
  extract:  'cerebras,groq,gemini,deepseek',
  // judgment task: any reasoning model. Free fast first.
  match:    'cerebras,groq,gemini,openai',
  // vision required; only providers with vision support
  photo:    'gemini,openai,xai',
  // batch cron, latency-tolerant, prefer cheap+fast
  calendar: 'cerebras,gemini,deepseek',
  default:  'gemini'
};

// ====================================================================
//  Public API
// ====================================================================

export async function complete(opts) {
  const task = opts.task || 'default';
  const order = providerOrder(task);
  const tried = [];
  let lastErr;

  for (const name of order) {
    if (!ADAPTERS[name]) continue;
    if (!HAS_KEY[name]()) continue;
    tried.push(name);
    try {
      const result = await ADAPTERS[name](opts);
      result.__provider = name;   // stamp so callers can attribute (used in benchmarks)
      return strip(result);
    } catch (err) {
      lastErr = err;
      console.warn(`[_models] task=${task} provider=${name} failed: ${err.message}. Trying next.`);
    }
  }

  // If every available provider failed AND any of them was a 429, parse the
  // suggested retry-after, sleep up to 5s (capped to fit Vercel Hobby's 10s
  // function timeout), and retry the same providers once more.
  if (tried.length && lastErr && /\b429\b/.test(String(lastErr.message))) {
    const retryMs = Math.min(parseRetryAfterMs(lastErr.message) ?? 1500, 5000);
    await sleep(retryMs);
    for (const name of tried) {
      try {
        const result = await ADAPTERS[name](opts);
        result.__provider = name;
        return strip(result);
      } catch (err) {
        lastErr = err;
      }
    }
  }

  throw lastErr || new Error(`No usable model provider for task=${task} (set GEMINI_API_KEY at minimum)`);
}

export function availableProviders() {
  return Object.keys(ADAPTERS).filter(name => HAS_KEY[name]());
}

function providerOrder(task) {
  const env = process.env[`MODEL_${task.toUpperCase()}`];
  if (env) return env.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const fallback = process.env.MODEL_DEFAULT || DEFAULTS_BY_TASK[task] || DEFAULTS_BY_TASK.default;
  return fallback.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

// Strip the __provider tag from text-only results before returning to callers
// (we only need it for benchmarks; callers shouldn't see it in normal use).
function strip(result) {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const out = { ...result };
    delete out.__provider;
    return out;
  }
  return result;
}

// ====================================================================
//  Adapters — Gemini and Anthropic use their native APIs
// ====================================================================

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

async function anthropicComplete({ system, user, json, temperature = 0.2, maxTokens = 800, model = 'claude-haiku-4-5-20251001' }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
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
  const clean = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim();
  return safeJson(clean);
}

// ====================================================================
//  Shared adapter for OpenAI-compatible chat APIs
// ====================================================================
//
// Used by: openai, cerebras, groq, deepseek, mistral, kimi, perplexity, xai.
// All of them expose `POST /chat/completions` with the same body shape.

async function openaiCompatible({ system, user, json, temperature = 0.2, maxTokens = 800, model }, cfg) {
  const apiKey = pickKey(cfg.authEnv);
  if (!apiKey) throw new Error(`${cfg.label}: no API key configured`);

  // Vision: pass image parts only if this provider supports vision
  let messages;
  if (Array.isArray(user)) {
    if (cfg.vision) {
      const content = user.map(p => {
        if (p.text) return { type: 'text', text: p.text };
        if (p.inlineData) return {
          type: 'image_url',
          image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
        };
        return null;
      }).filter(Boolean);
      messages = [{ role: 'system', content: system }, { role: 'user', content }];
    } else {
      // Strip image parts; keep text only. If no text, error early.
      const textOnly = user.filter(p => p.text).map(p => p.text).join('\n\n');
      if (!textOnly) throw new Error(`${cfg.label}: vision not supported and user content is image-only`);
      messages = [{ role: 'system', content: system }, { role: 'user', content: textOnly }];
    }
  } else {
    messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  }

  // JSON mode varies slightly by provider; the OpenAI standard works on
  // OpenAI/Cerebras/Groq/DeepSeek/Mistral/Kimi/xAI. Perplexity needs slight
  // tolerance — fall back to "ask for JSON in the prompt" if their endpoint
  // rejects response_format.
  const body = {
    model: model || cfg.defaultModel,
    messages,
    temperature,
    max_tokens: maxTokens
  };
  if (json && cfg.jsonMode === 'response_format') {
    body.response_format = { type: 'json_object' };
    // Some providers require the word 'json' in the prompt when using JSON mode.
    if (!/json/i.test(system)) body.messages[0].content = `${system}\n\nReturn JSON.`;
  }

  const r = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`${cfg.label} ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content || '';
  return json ? safeJson(text) : text;
}

// ====================================================================
//  Helpers
// ====================================================================

function pickKey(envOrEnvs) {
  if (Array.isArray(envOrEnvs)) {
    for (const e of envOrEnvs) if (process.env[e]) return process.env[e];
    return null;
  }
  return process.env[envOrEnvs] || null;
}

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

function parseRetryAfterMs(msg) {
  const m = String(msg).match(/retry in ([\d.]+)\s*s/i);
  if (m) return Math.ceil(parseFloat(m[1]) * 1000);
  return null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}
