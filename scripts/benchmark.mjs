#!/usr/bin/env node
//
// Pocket Steve — multi-model benchmark harness.
//
// Runs Pocket Steve's actual production tasks (extract, brief, match,
// linkedin, calendar) against every provider that has an API key
// configured in the environment. Captures latency, output sample, error
// (if any), and writes a comparison Markdown report under
// docs/benchmarks/<UTC timestamp>.md.
//
// USAGE:
//   node scripts/benchmark.mjs                     # run all tasks against all providers with keys
//   node scripts/benchmark.mjs --task extract      # only one task
//   node scripts/benchmark.mjs --providers gemini,kimi
//
// REPRODUCIBILITY:
//   The test fixtures below are FIXED. Any change to them is a deliberate
//   methodology change and should be committed alongside the benchmark
//   results so a reader can compare apples to apples across versions.
//
// SCIENCE:
//   We measure three things per (task, provider) cell:
//     (1) Latency (ms, single-shot).
//     (2) Validity — did the output parse as expected JSON shape?
//     (3) A short qualitative output sample for human inspection.
//   We deliberately do NOT auto-grade quality with another LLM. Briefing
//   quality is a memory-trigger judgment best made by humans reviewing
//   side-by-side outputs, not by a hallucinable LLM-as-judge.

import { complete, availableProviders } from '../api/_models.js';
import { writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ----- fixed test fixtures (do NOT edit casually) -----

const FIXTURES = {
  extract: {
    description: 'Voice-memo style dump → structured fields',
    task: 'extract',
    json: true,
    temperature: 0.2,
    maxTokens: 800,
    system: `You extract structured details from a person's quick voice memo about people they just met.

Return ONLY valid JSON in this shape:
{
  "headline": "...8 words max...",
  "summary": "2-3 sentence second-person reminder",
  "names": [], "kids": [], "pets": [], "traits": [],
  "where": "..."
}`,
    user: `Voice memo: "Met a couple at the school carnival, dog named Otis, kid Malachi, from California, all tatted up and look very alternative. Sarah works at Nationwide and Dan's a fireman."

User-provided "where" (may be empty): "Elementary School Carnival"

Return the JSON now.`,
    expectKeys: ['headline', 'summary', 'names', 'kids', 'pets', 'traits', 'where']
  },
  brief: {
    description: 'Memory-trigger briefing for an upcoming event',
    task: 'brief',
    json: true,
    temperature: 0.4,
    maxTokens: 1500,
    system: `You help someone remember people they've met. Given a place they're heading to and a list of past meetings, find the relevant ones and write a short memory-trigger briefing for each match.

Match loosely. Each briefing is 2-3 sentences in second person, warm and specific. Lead with names if known. Hit the distinctive details first.

Return JSON: {"matches": [{"id": "...", "briefing": "..."}]}`,
    user: `Heading to: "elementary school"

Past meetings:
${JSON.stringify([
  { id: 'e1', where: 'Elementary School Carnival', headline: 'Couple from California with kid Malachi', summary: 'Tattooed couple from CA with kid Malachi (5), dog Otis (pug). Sarah at Nationwide, Dan a fireman.', when: '2026-04-12' },
  { id: 'e2', where: 'Lake House', headline: 'Pat with two huskies Storm and Echo', summary: 'You met Pat at the lake house. Total dog person, two huskies named Storm and Echo.', when: '2026-03-30' }
], null, 2)}

Return the JSON now.`,
    expectKeys: ['matches']
  },
  match: {
    description: 'Decide if a new capture is the same person as an existing entry',
    task: 'match',
    json: true,
    temperature: 0.1,
    maxTokens: 400,
    system: `You decide whether a brand-new capture about a person/group describes the SAME person/group as an existing entry. A common first name alone is NOT enough. Same kids' names + same pets + same context = strong match.

Return JSON: {"match_id": "...", "confidence": "high|medium|low|none", "reason": "..."}`,
    user: `New capture: ${JSON.stringify({ headline: 'Couple again with Malachi and Otis', summary: 'Saw them at school pickup', where: 'Elementary School', kids: ['Malachi'], pets: ['Otis (dog)'] })}

Existing root entries:
${JSON.stringify([
  { id: 'aaa-111', headline: 'Couple from California with kid Malachi', where: 'Elementary School Carnival', kids: ['Malachi'], pets: ['Otis (dog)'], traits: ['tattooed'] },
  { id: 'bbb-222', headline: 'Sarah from accounting', where: 'Office party', kids: [], pets: [], traits: [] }
], null, 2)}

Return the JSON now.`,
    expectKeys: ['match_id', 'confidence', 'reason']
  },
  linkedin: {
    description: 'Extract person fields from pasted LinkedIn-style text',
    task: 'linkedin',
    json: true,
    temperature: 0.2,
    maxTokens: 900,
    system: `You extract structured details about a person from a snippet of profile text.

Return JSON:
{ "headline": "...", "summary": "...", "names": [], "traits": [], "where": "", "linkedin_url": "", "raw_text": "..." }`,
    user: `User-pasted profile text:

Sarah Chen
Director of Product at Notion
San Francisco, CA

Formerly Senior PM at Stripe (2018-2023). Stanford BS in Computer Science (2014). Builder of distributed systems. Mom of two. Marathon runner.`,
    expectKeys: ['headline', 'summary', 'names', 'traits']
  },
  calendar: {
    description: 'Match upcoming calendar events to saved entries (cron task)',
    task: 'calendar',
    json: true,
    temperature: 0.2,
    maxTokens: 2000,
    system: `You match upcoming calendar events to past meetings. Match only on clear semantic overlap between the event (title or location) and where the entry was met. Be strict.

Return JSON: {"matches": [{"event_index": <int>, "event_uid": "...", "entry_id": "...", "briefing": "..."}]}`,
    user: `Upcoming events:
${JSON.stringify([
  { index: 0, uid: 'evt-1', summary: 'School pickup', location: 'Elementary School', startsAt: '2026-05-12T15:00:00Z' },
  { index: 1, uid: 'evt-2', summary: 'Dentist', location: 'Maple Dental', startsAt: '2026-05-14T09:00:00Z' }
], null, 2)}

Past meetings:
${JSON.stringify([
  { id: 'aaa-111', where_met: 'Elementary School Carnival', headline: 'Couple from California with kid Malachi' }
], null, 2)}

Return the JSON now.`,
    expectKeys: ['matches']
  }
};

// ----- CLI parse -----

const args = parseArgs(process.argv.slice(2));
const taskFilter = args.task ? new Set(args.task.split(',')) : null;
const providersArg = args.providers ? args.providers.split(',').map(s => s.trim().toLowerCase()) : null;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
      out[key] = val;
    }
  }
  return out;
}

// ----- discovery -----

const allKnown = ['gemini', 'anthropic', 'openai', 'cerebras', 'groq', 'deepseek', 'mistral', 'kimi', 'perplexity', 'xai'];
const available = providersArg
  ? providersArg.filter(p => allKnown.includes(p))
  : availableProviders();

if (!available.length) {
  console.error('No providers with API keys configured.');
  console.error('Set at least GEMINI_API_KEY, then any of: ANTHROPIC_API_KEY, OPENAI_API_KEY, CEREBRAS_API_KEY, GROQ_API_KEY, DEEPSEEK_API_KEY, MISTRAL_API_KEY, KIMI_API_KEY, PERPLEXITY_API_KEY, XAI_API_KEY');
  process.exit(1);
}

const tasksToRun = taskFilter
  ? Object.keys(FIXTURES).filter(t => taskFilter.has(t))
  : Object.keys(FIXTURES);

console.log(`\nPocket Steve benchmark — ${available.length} provider(s) × ${tasksToRun.length} task(s)`);
console.log(`Providers: ${available.join(', ')}`);
console.log(`Tasks:     ${tasksToRun.join(', ')}\n`);

// ----- run -----

const results = [];

for (const taskName of tasksToRun) {
  const fixture = FIXTURES[taskName];
  console.log(`\n─── ${taskName.toUpperCase()} ─── ${fixture.description}`);

  for (const provider of available) {
    process.stdout.write(`  ${provider.padEnd(11)}`);
    const t0 = Date.now();
    let outcome;
    try {
      // Force this provider for this call by setting the per-task env var,
      // run, then unset.
      const envKey = `MODEL_${fixture.task.toUpperCase()}`;
      const prev = process.env[envKey];
      process.env[envKey] = provider;
      try {
        const out = await complete({
          task: fixture.task,
          system: fixture.system,
          user: fixture.user,
          json: fixture.json,
          temperature: fixture.temperature,
          maxTokens: fixture.maxTokens
        });
        outcome = { ok: true, output: out };
      } finally {
        if (prev === undefined) delete process.env[envKey];
        else process.env[envKey] = prev;
      }
    } catch (err) {
      outcome = { ok: false, error: err.message };
    }
    const ms = Date.now() - t0;

    let validity = '—';
    if (outcome.ok && fixture.expectKeys && typeof outcome.output === 'object') {
      const have = fixture.expectKeys.filter(k => k in outcome.output);
      validity = `${have.length}/${fixture.expectKeys.length}`;
    } else if (outcome.ok) {
      validity = 'ok';
    }

    const tag = outcome.ok ? '✓' : '✗';
    console.log(` ${tag} ${ms.toString().padStart(5)}ms  ${validity.padEnd(5)}  ${oneLine(outcome.ok ? sample(outcome.output) : outcome.error).slice(0, 90)}`);

    results.push({
      task: taskName,
      provider,
      ok: outcome.ok,
      latency_ms: ms,
      validity,
      sample: outcome.ok ? oneLine(sample(outcome.output)).slice(0, 240) : null,
      error: outcome.ok ? null : oneLine(outcome.error).slice(0, 240)
    });
  }
}

// ----- write report -----

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const reportDir = join(ROOT, 'docs', 'benchmarks');
mkdirSync(reportDir, { recursive: true });
const reportPath = join(reportDir, `${stamp}.md`);

const md = renderMarkdown(results, available, tasksToRun);
writeFileSync(reportPath, md);

console.log(`\nWrote report → docs/benchmarks/${stamp}.md`);
console.log(`Pass rate: ${results.filter(r => r.ok).length}/${results.length}`);

// ----- helpers -----

function sample(out) {
  if (typeof out === 'string') return out;
  if (out && typeof out === 'object') {
    if (out.headline) return `[${out.headline}] ${out.summary || ''}`;
    if (out.matches?.[0]?.briefing) return `[${out.matches.length} match] ${out.matches[0].briefing}`;
    if (out.match_id !== undefined) return `match_id=${out.match_id || '<none>'} conf=${out.confidence || ''}`;
    return JSON.stringify(out);
  }
  return String(out);
}

function oneLine(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function renderMarkdown(rows, providers, tasks) {
  const ts = new Date().toISOString();
  let md = `# Pocket Steve benchmark — ${ts}\n\n`;
  md += `Providers tested: **${providers.join(', ')}**\n\n`;
  md += `Tasks: ${tasks.join(', ')}\n\n`;
  md += `## Latency (ms) and validity per (task × provider)\n\n`;
  md += `| Task | ${providers.map(p => p).join(' | ')} |\n`;
  md += `|---| ${providers.map(() => '---').join(' | ')} |\n`;
  for (const t of tasks) {
    md += `| **${t}** |`;
    for (const p of providers) {
      const r = rows.find(x => x.task === t && x.provider === p);
      if (!r) md += ` — |`;
      else if (!r.ok) md += ` ✗ (${truncate(r.error, 50)}) |`;
      else md += ` ✓ ${r.latency_ms}ms · ${r.validity} |`;
    }
    md += `\n`;
  }
  md += `\n## Sample outputs\n\n`;
  for (const t of tasks) {
    md += `### ${t}\n\n`;
    for (const p of providers) {
      const r = rows.find(x => x.task === t && x.provider === p);
      if (!r) continue;
      md += `**${p}** (${r.ok ? `${r.latency_ms}ms · ${r.validity}` : 'failed'}):  \n`;
      md += `${r.ok ? r.sample : '`' + r.error + '`'}\n\n`;
    }
  }
  md += `\n## Methodology\n\n`;
  md += `Fixtures are fixed in \`scripts/benchmark.mjs\`. Each cell is a single-shot call (no retries, no warmup). Latency includes network round-trip. Validity is "expected_keys_present / expected_keys_total" for JSON tasks. Quality is *not* auto-graded — read the sample column with your own eyes.\n\n`;
  md += `Each run produces a timestamped Markdown file under \`docs/benchmarks/\` so cross-run comparisons stay reproducible.\n`;
  return md;
}

function truncate(s, n) {
  s = String(s ?? '');
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
