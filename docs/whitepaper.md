# Steve — A Memory Trigger for the People You Meet

*A whitepaper on the science, the competition, and the moat.*

> *"I was at this thing at the elementary school today, and I met this couple. I got his name, I got her name, and I got their kid's name, and then a couple of key qualities — they had a little pug, real cute little pug. As I was leaving, I thought: within a day or two I will forget all that."*
>
> &mdash; Steve, May 2026, the conversation that started this app

---

## 1. The problem in one paragraph

Adults forget the names, kids, pets, and distinctive details of the people they meet at social and professional events within hours. The cost is silent but real: trust is built on remembering. The person who walks up to a casual acquaintance six months later and says *"How's Malachi doing?"* creates a small but durable bond. The person who blanks does not. Existing tools — personal CRMs, note apps, voice memo apps — either treat this as a database problem (search a list) or a habits problem (remember to log it). Neither solves it. Both make the user do the work the brain is already failing to do.

**Steve treats the problem as a *memory trigger* problem.** Capture has to be near-zero effort (voice, photo, no fields). Recall has to be proactive (the app surfaces who you might see *before* you walk into the next event), and it must give just enough cue to spark the user's own memory rather than dump a database row at them. The product's job is to be the spark, not the warehouse.

This document covers (1) the science of why this works, (2) what existing tools get right and wrong, (3) the moat we're building, and (4) where we go next.

---

## 2. The memory science: why a "trigger" beats a "database"

The cognitive science here is over a century old and remarkably well-replicated. Four mechanisms matter for our design:

### 2.1 The forgetting curve (Ebbinghaus, 1885)

Hermann Ebbinghaus established that **memory loss is logarithmic and front-loaded**. About half of newly encoded information is lost within an hour; about 70% within 24 hours; the curve flattens after that. Steve's *"within a day or two I will forget all that"* is not anecdote — it is the textbook curve. ([Ebbinghaus, replicated 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4492928/); [overview](https://en.wikipedia.org/wiki/Forgetting_curve))

The intervention that defeats the curve isn't more attention at encoding — it's **structured rehearsal at decreasing intervals** (the spacing effect). Users will not deliberately rehearse a stranger's kid's name. So the app has to do the rehearsal *for* them, by surfacing the saved entry in a relevant moment. Calendar-driven nudges and "Heading somewhere?" briefings are this rehearsal mechanism.

### 2.2 Encoding specificity (Tulving & Thomson, 1973)

The encoding specificity principle states that **memory recall is best when the cues present at retrieval match the cues present at encoding.** ([overview](https://thedecisionlab.com/reference-guide/psychology/forgetting-curve), [encoding-retrieval-forgetting reference](https://premiermcatprep.com/mcat-books/behavioral-sciences/memory-attention-and-cognition/encoding-retrieval-forgetting))

This has direct UX consequences:

- **Where you met them** is the highest-value retrieval cue, because place is highly associative. *"School carnival"* recalls everything about that night more reliably than someone's first name.
- **Who they were with** (their kids, their partner, their dog) is a secondary cue that re-activates the schema.
- **Distinctive traits** ("all tatted up", "from California") work because they break the pattern of generic faces.

Steve indexes by `where_met` first because that's the cue most likely to fire when the user is heading back to that place. Every other field exists to deepen the cue, not to be searched as a database.

### 2.3 Cue-dependent forgetting (Tulving)

The "tip of the tongue" experience proves a key truth: **most "forgotten" memories aren't gone, they're just unreachable without the right cue.** Recognition hits 90%+ accuracy where free recall fails. ([structural-learning.com](https://www.structural-learning.com/post/ebbinghaus-forgetting-curve))

Steve's recall flow ("Heading somewhere?") is a recognition task, not a recall task. The user types a place; the app surfaces a card; the user recognizes the people instantly. The brain does the heavy lifting from there. This is why the briefing only needs to be **two or three sentences** — it's a spark, not a transcript.

### 2.4 Levels of processing (Craik & Lockhart, 1972) and dual coding (Paivio, 1971)

Two related findings:

- **Deeper, more elaborative encoding produces more durable memory.** Saying "the couple from California" is shallower than saying "the couple from California with the pug named Otis whose son is named Malachi" — the latter creates more retrieval pathways.
- **Visual + verbal encoding outperforms either alone** (dual coding). Snapping a photo of a name tag plus dictating context creates two anchored memories.

This is why our `/api/extract` and `/api/extract-photo` endpoints fan out into structured fields (names, kids, pets, traits, where, raw text) rather than storing one blob. Every field is another retrieval pathway.

### 2.5 What the science tells us NOT to build

- **Don't build search-first UX.** Search punishes weak cues — the user has to already remember enough to find the entry. Recognition and proactive surfacing don't.
- **Don't fragment one person across many entries.** That fights the schema-completion mechanism. Per-person history (timeline) is the right structure.
- **Don't gamify, streak, or otherwise reward "use this every day."** The user opens the app at the moments dictated by their actual life (just met someone, heading somewhere). Anything that demands more frequent interaction creates friction without memory benefit.
- **Don't make the app a notebook.** Notebooks are open-ended; they punish brevity. Steve should reward 20-second voice dumps and never expect a 5-paragraph write-up.

---

## 3. The competitive landscape

We did not invent personal relationship management software. The category has matured. But every existing player optimizes for a different job-to-be-done than the one Steve described, which is what creates an opening.

### 3.1 The personal CRMs

| Tool | Pricing | Core thesis | What they get right | What they miss |
|---|---|---|---|---|
| **[Dex](https://getdex.com)** | $12-20/mo | "Never lose touch" via reminders + LinkedIn sync | 12+ native integrations (LinkedIn, Gmail, WhatsApp, Outlook). Job-change alerts. Pre-meeting briefs. The most polished of the personal CRMs. | Reminders are time-based ("you haven't talked to Dan in 60 days"), not event-based. Capture still requires typing into form fields. Optimized for LinkedIn-heavy professionals — won't serve a parent at a school carnival. |
| **[Cloze](https://www.cloze.com)** | $17-42/user/mo | AI logs every email, call, text, social interaction automatically | Zero manual logging — passively absorbs your communication history | Locks key features behind tiers. Heavy/enterprise feel. Zero affordance for the "I just met someone in the parking lot" moment. |
| **[Folk](https://www.folk.app)** | $24/seat/mo | All-in-one CRM with templates for sales, fundraising, recruiting | Pipeline, bulk email, team collaboration. Excellent if your relationships are commercial | A team CRM. Not built for individuals at the school carnival. |
| **[Clay (Mesh)](https://clay.earth)** | $5-20/mo | "Relationship intelligence" — surfaces context automatically | Beautiful timeline UI. Strong enrichment from LinkedIn/Twitter | Emphasizes browsing your existing network, less on capturing strangers. Subscription required for meaningful use. |
| **[UpHabit](https://uphabit.com)** | varies | Originally personal-CRM, pivoted to "relationship selling" | — | Pivoted away from the core use case. Existing users were told to find alternatives. ([Dex's review](https://getdex.com/blog/streak-crm-review-2026-using-a-gmail-crm-for-personal-networking/)) |
| **[Monica](https://monicahq.com)** | Free (self-hosted) or $9/mo | Open-source personal CRM | Privacy-first, self-host option, generous free tier | Form-heavy capture. No voice. Niche audience. |

**Synthesis.** Personal CRMs are competent at *maintaining* relationships you already know exist. They are weak at *encoding* relationships you don't know exist yet — the exact moment Steve targets. None of them are voice-first; all of them require the user to type into fields. None of them tie capture to *place* (where_met) as the primary index. None of them surface people based on *upcoming events* — they surface based on time-since-last-contact.

### 3.2 The AI memory & voice apps

| Tool | Pricing | Thesis | Notes |
|---|---|---|---|
| **[Mem.ai](https://mem.ai)** | $14.99/mo | AI-native personal knowledge | Powerful for general notes; not relationship-specific. |
| **[Voicenotes](https://voicenotes.com)** | Freemium | Voice-first AI notes you can ask | Closest in *capture pattern* to Steve. But the data model is conversation-first, not person-first. |
| **[AudioPen](https://audiopen.ai)** | $4-7/mo | Voice → polished text in any style | Excellent for writers/bloggers. Wrong shape for relationship memory. |
| **[Speakwise](https://speakwiseapp.com)** | Freemium | Voice → structured notes with Notion sync | Good polish; same gap as AudioPen — note-shaped, not person-shaped. |
| **[Remi8](https://remi8.ai)** | Freemium | Captures phone calls and FaceTime, transcribes, summarizes | More about meetings than meeting people. |
| **[Otter](https://otter.ai), [Granola](https://granola.ai)** | varies | Meeting transcription + summary | Adjacent — useful inside formal meetings, not at school carnivals. |
| **[Rewind](https://rewind.ai)** | $20/mo | Captures *everything* you do on a Mac | Mac-only, desktop-only. Wrong context. |

**Synthesis.** The voice-first AI memory category is full of excellent tools that *almost* solve the problem. They prove voice is the right modality and AI is the right transformation layer. But all of them are **note-shaped**: they index on the recording, not on the person. None of them do the "Heading somewhere? Here's who you've met there" recall flow.

### 3.3 The honest comparison: who is closest?

If we had to pick the single closest competitor, it's **Dex**. They've thought hardest about the relationship-management category. They have polish, integrations, and a paying user base.

The space between Dex and Steve:

- **Capture modality.** Dex is type-first with email/LinkedIn import. Steve is voice-first and photo-first. At a kids' school event, the user is not on LinkedIn — they're talking to a stranger holding a juice box. Voice + photo is the right modality for this moment; type + import is the wrong one.
- **Recall trigger.** Dex's reminders are time-based ("60 days since last contact"). Steve's are place-based and event-based ("you have a calendar event tomorrow at the elementary school where you met Dan and Sarah"). Place is a stronger encoding cue than time, per encoding specificity.
- **Audience.** Dex serves the LinkedIn-heavy professional. Steve serves the same person *and* the parent at the school carnival, *and* the salesperson at the conference. Wider net, lower per-user complexity.

---

## 4. The moat

A sharp wedge isn't enough. Below are the four mechanisms that, used together, make Steve durable.

### 4.1 The data moat (compounding switching cost)

Every saved person is a switching cost. After six months of use, a Steve user has 50–200 entries with rich context: who they met, where, with whom, what was distinctive. Migrating that to another tool is unattractive — even if a competitor matches the feature set, the user is choosing between *keep using Steve* and *re-build from zero somewhere else*. This is the same moat that retains Notion users despite cheaper alternatives.

We strengthen this by:

- Per-person history (already shipped) — relationships accumulate context over time, becoming individually irreplaceable.
- Future: relationship graph (who knows whom, who I met through whom) — once a user has built this graph, it cannot be reproduced.

### 4.2 The voice + photo capture combo

Most competitors offer one or the other, badly. Steve does both, well, and for the same data model. Photo-OCR pre-fills fields; voice adds context; the two compound (dual coding theory).

This is a genuinely defensible technical advantage in 2026 because:

- Gemini 2.5 Flash Vision (and the equivalent OpenAI/Anthropic models) finally make business-card OCR + speech transcription work at quality and latency that fit the moment.
- The composite UX (snap → talk → save in one screen) requires deliberate product design that most general-purpose tools won't bother with.

### 4.3 Calendar-driven proactive recall

This is the feature most likely to make the product feel magical and differentiate from every other personal CRM:

> *Steve has a calendar event Saturday at the elementary school. Steve has matched that event location to the place where Steve met Dan and Sarah three months ago. Saturday morning at 8am, Steve gets an email: "You're heading to the school today. Last time you were there you met Dan and Sarah — kid Malachi, dog Otis, all tatted up, from California."*

No personal CRM does this. The closest analog is Dex's pre-meeting briefs, which are generated only for events with explicit attendees — a corporate calendar pattern. Steve's nudges fire on *any* event matching a place where the user has met someone, including unstructured social events that have no attendee list.

Tooling: **Microsoft Graph OAuth + .ics share URL fallback** are scaffolded in the v1 codebase (`api/oauth/microsoft.js`, `api/_microsoft.js`, `.ics` parser in `api/_ics.js`). Google Calendar OAuth is queued for a future iteration but is *not* shipped today.

### 4.4 Multi-model routing (the model is not the product)

Steve does not commit to a single language model. The codebase has a thin routing layer (`api/_models.js`) that exposes one function — `complete({ task, system, user, json })` — and dispatches to whichever provider serves that task best.

| Task | Default routing | Why |
|---|---|---|
| `extract` (voice memo → fields) | Gemini 2.5 Flash | High volume, cheap, fast. Gemini is excellent at structured extraction. |
| `brief` (memory-trigger prose) | `anthropic,gemini` | The user-facing moment of truth. Claude writes warmer, more memorable prose. Falls back to Gemini if no Anthropic key. |
| `match` (is this the same person?) | `gemini,openai` | Conservative judgment task; either provider works. |
| `photo` (Vision OCR) | `gemini,openai` | Both providers are vision-capable. |
| `linkedin` (URL/text → fields) | `gemini,anthropic` | Anthropic is good at parsing semi-structured profile prose. |
| `calendar` (event ↔ entry matching, in cron) | Gemini | Latency-tolerant batch job; cheapest provider wins. |

Routing is configurable per task via env vars (`MODEL_BRIEF=anthropic,gemini`), so quality vs. cost trade-offs can be tuned without code changes. New providers (Cerebras, Groq, DeepSeek, Mistral, on-device Apple Foundation Models) drop in as additional adapters.

This is a moat in two senses:

1. **Resilience.** When any one provider has an outage, rate-limits us, raises prices, or degrades quality, we route around it without code changes. Single-provider competitors take an outage with their provider.
2. **Quality routing.** Each task in the product has different latency, cost, and quality requirements. Locking to one model leaves quality on the table for high-stakes tasks (briefings) or money on the table for high-volume tasks (extraction). Per-task routing extracts the maximum value from the model market as it evolves month-to-month.

The product is "a memory trigger for the people you meet," not "an app powered by Gemini." That distinction is the whole point.

### 4.5 Validation methodology — every claim must be testable

Two epistemic standards govern this whitepaper:

1. **Competitive differentiators are defended by peer-reviewed cognitive science**, not by founder intuition. Section 5 lists each differentiator alongside the specific psychological mechanism it implements and the original-source citation. If a future iteration cannot point to a defensible mechanism, it doesn't ship.
2. **Model-level claims are defended by reproducible benchmarks**, not by vendor marketing. The benchmark harness at `scripts/benchmark.mjs` runs Steve's actual production tasks (extract, brief, match, linkedin, calendar) against every provider with an API key configured, captures latency + output validity, and writes a timestamped report to `docs/benchmarks/`. Anyone with the repo can reproduce a run and audit the routing decisions.

The benchmark harness deliberately does **not** use an LLM-as-judge for quality grading — quality of memory-trigger prose is a human judgment, not a model judgment, and using a model to grade other models is a known source of self-reinforcing bias ([Zheng et al., 2023](https://arxiv.org/abs/2306.05685)). Latency and output validity (does the JSON parse? do the expected fields exist?) are machine-graded; qualitative output samples are written into the report for human side-by-side comparison.

The provider roster currently includes: **Gemini, Anthropic Claude, OpenAI, Cerebras (Llama), Groq (Llama), DeepSeek, Mistral, Kimi K2 (Moonshot), Perplexity (Sonar with web search), and xAI Grok.** Each routes through the same `complete()` function via a shared OpenAI-compatible adapter, so adding the next provider is a 5-line config block. Providers without a configured API key are skipped silently.

### 4.6 Automation in the moment — the hardware question

Recurring strategic question: *should Steve be a piece of dedicated hardware?* (An AI pin like Humane, a pendant like Friend, smart glasses like Meta Ray-Bans, an always-on listener.)

Answer: **No new hardware. Software hooks into the hardware users already carry.**

Three reasons:

1. **The user already has the right hardware.** iPhone in pocket, AirPods in ears, Apple Watch on wrist. Each is a complete capture-and-recall surface for Steve. Asking the user to buy a new device is a 10× friction step that competitors who tried (Humane, Friend, Rabbit r1) have demonstrated does not work.
2. **The category-defining moment is software polish, not hardware novelty.** Wispr Flow is not Wispr Pin. The differentiator is Cmd-K + a great model + low friction, not new silicon. Steve's equivalent is *one-tap-or-one-Siri-phrase* + a great model + sharp recall UX.
3. **The integration surface that matters most is iOS itself.** Specifically: iOS Shortcuts + Siri intents + Lock Screen widgets + Apple Calendar + AirPods voice triggers. Each of these is a free and durable software hook that any user with an iPhone can wire up in 60 seconds without buying anything.

The roadmap maps the automation surface, not the hardware surface:

| Layer | Mechanism | Example moment |
|---|---|---|
| **Now** | iOS Shortcut deep link → `https://memory-trigger.vercel.app/?action=capture` | "Hey Siri, Steve me" → app opens to capture, mic focused. One Siri phrase → 1 tap to save. |
| **Now** | URL param `?text=` and `?where=` for share-sheet handoffs | Share a contact card from any iPhone app → text gets pre-filled in capture. |
| **Now** | Top-of-mind home-screen panel | Open the app → see the 3 people you might run into this week without searching. |
| **v1.5** | iOS PWA Push Notifications (iOS 16.4+ supports for installed PWAs) | 30 minutes before a tagged event → push lands → tap to open the briefing. |
| **v2** | Lock Screen widget | Glanceable "today's people" card on the lock screen, no app open required. |
| **v2** | Apple Watch complication via PWA | Wrist flick shows the next memory-trigger card. |
| **v3** | AirPods + iOS Shortcut + speech intent | "Steve, brief me" through earbuds while walking up to the door. The whisper happens in the AirPods. |
| **v4 (years out)** | Smart glasses (Meta Ray-Bans, Apple Vision) — *partner integration, not our hardware* | Face recognition on glance + earbud whisper. We integrate; we don't build the glasses. |

Every entry on this roadmap is software running on hardware the user already owns. The lowest layer (iOS Shortcut) ships in v1.4 today. Each subsequent layer compounds without invalidating the previous.

The product is the *trigger*. The hardware is whatever the user already has between them and the moment.

### 4.7 Validation: distinguishing little from large model improvements

Adding a 4th, 5th, or 10th model provider to the routing layer is cheap. Knowing whether each one is a *little* or *large* improvement requires a measurement standard, not a vibe check.

The benchmark harness at `scripts/benchmark.mjs` runs each task against every available provider and writes a timestamped report under `docs/benchmarks/`. The metrics:

- **Latency** (ms, single-shot, network round-trip included)
- **Validity** (does the output parse as the expected JSON shape, with all expected keys present)
- **Output sample** (saved verbatim for human side-by-side comparison)

We deliberately skip LLM-as-judge quality grading — [Zheng et al. (2023)](https://arxiv.org/abs/2306.05685) document the bias. Quality of memory-trigger prose is human-judged on the saved samples.

**Improvement thresholds** (these are how a benchmark report is read):

| Delta vs. baseline | Interpretation |
|---|---|
| Latency: **−50% or more** | LARGE improvement. Worth routing the task to the new provider, even at slightly higher cost. The user feels the speed. |
| Latency: **−15% to −50%** | Moderate improvement. Worth a fallback-position slot in the routing list. |
| Latency: **±15%** | Little or no improvement. Keep as a redundant fallback for resilience only. |
| Validity: **drops below 100%** on a JSON task | Regression. Do not route this task to that provider unless every other has failed. |
| Validity: **stable at 100%, sample noticeably warmer / sharper** (human read) | Move up the priority list for human-facing tasks like `brief`. The numbers say "same"; the eyes say "better." |

The current activation status of each provider:

| Provider | Status | Activate by |
|---|---|---|
| Gemini 2.5 Flash | ✅ Active | Already configured |
| Cerebras Llama 3.3 70B | Adapter shipped | Add `CEREBRAS_API_KEY` (free at cloud.cerebras.ai) |
| Anthropic Claude Haiku 4.5 | Adapter shipped | Add `ANTHROPIC_API_KEY` |
| OpenAI gpt-4o-mini | Adapter shipped | Add `OPENAI_API_KEY` |
| Groq Llama 3.3 70B | Adapter shipped | Add `GROQ_API_KEY` (free at console.groq.com) |
| DeepSeek | Adapter shipped | Add `DEEPSEEK_API_KEY` |
| Mistral Small | Adapter shipped | Add `MISTRAL_API_KEY` |
| Kimi K2 (Moonshot) | Adapter shipped | Add `KIMI_API_KEY` |
| Perplexity Sonar | Adapter shipped | Add `PERPLEXITY_API_KEY` |
| xAI Grok 4 | Adapter shipped | Add `XAI_API_KEY` |

The validation framework is in place. As keys come online, the benchmark script produces a comparable report each run. Pull requests welcome with new benchmark results in `docs/benchmarks/`.

### 4.8 Privacy as positioning

Every personal CRM competitor positions itself in some "professional networking" frame. Steve's positioning — *the parent at the elementary school carnival* — is emotionally distinct. We're not selling lead generation; we're selling presence. That has marketing implications:

- The category is not LinkedIn productivity — it's *the same family of products as* Calm, Headspace, Strava. Tools that help you be a better version of yourself.
- The privacy posture (no social, no team, no ads, your data is yours) is consistent with that positioning.
- The viral mechanism is one-on-one ("how did you remember Malachi's name?") rather than feed-driven.

---

## 5. Each competitive differentiator, scientifically defended

Every claim in the table below maps a Steve design choice to the peer-reviewed cognitive-science result that justifies it. If a competitor copies any one row, the moat survives because the *combination* — captured cheaply via voice/photo, indexed by place, surfaced proactively, threaded by person, encoded richly across multiple modalities — is what compounds.

| Differentiator | Mechanism | Original source |
|---|---|---|
| **Place-as-primary index (`where_met`)** | Encoding-specificity principle: recall is best when retrieval cues match encoding cues. Place is a high-associative cue, more reliable than time-since-contact. | Tulving & Thomson (1973), *Encoding specificity and retrieval processes in episodic memory.* Psychological Review, 80(5), 352–373. |
| **Pre-event "Heading somewhere?" briefing** | Cue-dependent retrieval + recognition memory. Recognition (>90% accuracy) outperforms free recall in field settings; the briefing converts the moment of arrival into a recognition task. | Tulving & Pearlstone (1966), *Availability vs. accessibility of information in memory.* Journal of Verbal Learning and Verbal Behavior, 5, 381–391. |
| **Voice + photo dual capture** | Dual-coding theory: simultaneous verbal and visual encoding produces stronger, more durable memory traces than either modality alone. Photo-OCR gives the visual; voice gives the elaborative verbal. | Paivio (1971), *Imagery and Verbal Processes.* New York: Holt, Rinehart and Winston. |
| **Voice-first capture (vs. forms)** | Levels-of-processing: deeper, more elaborative encoding produces more durable traces than shallow, structured encoding. Spontaneous voice memos generate semantic/elaborative encoding; form-filling produces shallow item-level encoding. | Craik & Lockhart (1972), *Levels of processing: A framework for memory research.* Journal of Verbal Learning and Verbal Behavior, 11, 671–684. |
| **Per-person history (timeline of re-meetings)** | Schema completion + spaced retrieval: each new note is a retrieval-practice event for the prior schema, distributing rehearsal across time. The timeline is itself a spacing intervention. | Roediger & Karpicke (2006), *Test-enhanced learning.* Psychological Science, 17(3), 249–255. |
| **Calendar-driven proactive nudges** | Spacing effect (distributed practice >> massed practice); event-triggered cuing matches encoding context. The cron rehearses the entry at exactly the moment the encoding context is about to recur. | Cepeda et al. (2006), *Distributed practice in verbal recall tasks.* Psychological Bulletin, 132(3), 354–380. |
| **Read-aloud (browser speechSynthesis on briefings)** | Dual-coding (again) + the production effect: hearing oneself / a synthesized voice say the words activates phonological representations alongside the visual. | MacLeod et al. (2010), *The production effect: delineation of a phenomenon.* Journal of Experimental Psychology: Learning, Memory, and Cognition, 36(3), 671–685. |
| **2–3 sentence briefing length cap** | Working-memory capacity (Miller's 7±2; modern estimates ≈4) constrains how much can be held while walking into a social event. The brief is sized for the bottleneck, not the database. | Cowan (2001), *The magical number 4 in short-term memory.* Behavioral and Brain Sciences, 24(1), 87–114. |
| **Lead briefings with names + distinctive traits** | Distinctiveness effect (von Restorff): atypical or distinctive items are preferentially retrieved. Tattoos, kids' names, pets are higher-value cues than generic facts. | von Restorff (1933), *Über die Wirkung von Bereichsbildungen im Spurenfeld.* Psychologische Forschung, 18, 299–342. |
| **Place + traits + names prompt structure (extraction)** | Self-reference + elaborative interrogation: extracting *why* this person is memorable creates stronger encoding than extracting *what* they look like. The prompts ask for distinctive traits, not just names. | Symons & Johnson (1997), *The self-reference effect in memory: A meta-analysis.* Psychological Bulletin, 121(3), 371–394. |

The single design principle in section 9 — *be the spark, not the warehouse* — is itself an application of cue-dependent retrieval theory: the user's brain holds the memory; the app holds only the cue.

## 6. Where we win, where we are vulnerable

### 5.1 We win when

- The user is mobile and the moment is unstructured (school event, party, conference floor, networking mixer, dog park).
- The user values *being remembered* / *being a better presence*, not *closing more deals*.
- The user already lives on iPhone and trusts a single voice tap more than a 7-field form.

### 5.2 We are vulnerable when

- A user is on desktop most of the time and lives in LinkedIn → Dex serves them better today.
- A user wants automated logging of all communication (Cloze) — we don't ingest emails or texts.
- A user is a sales professional with a CRM workflow — Folk/HubSpot serves them better.
- iCloud users can't connect their primary calendar with one click (Apple's limitation, not ours). The mitigation is good in-app instructions; the long-term solve is a native iOS app with EventKit access.

### 5.3 Where competitors will copy us

- Voice-first capture: any competitor can add this in a quarter. The differentiator becomes polish + the rest of our moat.
- Calendar-event nudging: any competitor can add this in a quarter once they decide it's worth it. The differentiator becomes our place-as-primary-cue data model and the per-person timeline that makes the briefings actually feel like memory triggers, not lists.

---

## 7. Roadmap that strengthens the moat

This is a roadmap of *moat-deepening* features, not feature-of-the-week ideas. Each row asks: does this make Steve harder to replace?

| Phase | Feature | Why it deepens the moat |
|---|---|---|
| **v1 (shipped)** | Voice capture, photo OCR, edit/delete, per-person history, magic-link auth, calendar nudge framework, .ics URL fallback, **invite flow with one-tap magic link** | Establishes the core capture-recall loop and per-person data shape |
| **v1.1 (removed v1.7.1)** | ~~LinkedIn paste-and-enrich~~ — pulled in the Falcon-9 simplification pass. Voice + photo cover the social/community capture wedge cleanly; the LinkedIn fold added a third path that diluted the primary moment. The endpoint code is gone; if a sales-focused cohort surfaces, it returns as a separate paste-mode rather than a peer to voice. | Discipline preserved: "be the spark, not the warehouse" |
| **v1.2** | iCloud Calendar via signed-in iOS Shortcut (workaround for Apple's API gap) | Closes the iCloud user gap that competitors can't close either |
| **v1.3** | Relationship graph: "you met Dan via Sarah at the school" | Network effect on the data — irreproducible elsewhere |
| **v2** | Native iOS app with EventKit, Apple Watch glance, real push notifications | Brings the app into the moment — fewer users miss the nudge |
| **v2.1** | Spaced-rehearsal nudges based on the forgetting curve | Optional weekly "people you might want to remember" digest. Strengthens encoding without being demanding. |
| **v3** | Voice-first ambient capture via AirPods + Siri Shortcut | "Hey Siri, I just met..." — the highest-leverage capture moment. Wispr-Flow-equivalent friction reduction. |
| **v4** | Smart-glasses integration (Meta Ray-Bans, Apple Vision) with face-recognition + earbud whisper | Endgame. Genuinely transforms the capture-recall loop. |

Note that nothing on this list pivots us toward a sales CRM, a feed, an enterprise tier, or any of the natural drift that destroys focused products. Discipline is part of the moat.

---

## 8. Validation evidence and what we still need to learn

### 7.1 What's known to work (signal we already have)

- **Steve's own framing is the design spec.** A non-technical user described, unprompted, the exact mechanism the cognitive science literature would predict. The product matches what humans intuitively want.
- **Voice capture works on iPhone Safari** without permissions friction (browser-native SpeechRecognition).
- **Gemini 2.5 Flash extracts structured fields** from a voice memo with sub-3-second latency at zero marginal cost (free tier sufficient for hundreds of users).
- **The PWA installs cleanly on iOS** via Add to Home Screen — passes the "feels like an app" test.
- **The match-and-merge logic** correctly identifies re-meetings without false-positives (Gemini conservative threshold tuned in `/api/entries/match`).

### 7.2 What we still need to learn (highest-value open questions)

1. **Does the briefing actually trigger memory the way Steve described?** Steve himself is the n=1 trial. His feedback after two weeks is the deciding signal. If yes → the product works. If no → the recall flow needs more cues (photos, group context, relationship graph).
2. **How often do users hit the "snap a card" path vs. voice path?** That tells us whether the wedge is networking events or social/community events. The product copy and roadmap diverge sharply based on this answer.
3. **What's the true habit cadence?** If users open Steve once a week and forget it the rest of the time, the calendar nudge becomes the only retention mechanism — and it has to work without fail.
4. **Will users tolerate a manual calendar-share-URL paste?** Or do we need to ship Microsoft/Google OAuth before the second cohort?

These are answered by use, not by debate.

---

## 9. The principle that decides everything

When in doubt, the design rule is:

> **Be the spark, not the warehouse.**

If a feature increases capture friction, kill it. If a feature requires the user to remember something the app should remember for them, kill it. If a feature delivers a database row instead of a 2-sentence trigger, redesign it.

Speed and simplicity aren't aesthetics. They're the load-bearing wall. The moment Steve becomes another tool the user has to remember to use, we have lost — because we are competing with the human brain itself, and the brain wins by default.

Stay narrow. Ship sharp.

---

## Appendix A — Source map

**Memory science (peer-reviewed primary sources)**
- Ebbinghaus, H. (1885). *Über das Gedächtnis* (the original forgetting curve). [Replication, PMC 2015](https://pmc.ncbi.nlm.nih.gov/articles/PMC4492928/)
- Tulving, E., & Thomson, D.M. (1973). *Encoding specificity and retrieval processes in episodic memory.* Psychological Review, 80(5), 352–373.
- Tulving, E., & Pearlstone, Z. (1966). *Availability versus accessibility of information in memory.* Journal of Verbal Learning and Verbal Behavior, 5, 381–391.
- Paivio, A. (1971). *Imagery and Verbal Processes.* New York: Holt, Rinehart and Winston.
- Craik, F.I.M., & Lockhart, R.S. (1972). *Levels of processing: A framework for memory research.* Journal of Verbal Learning and Verbal Behavior, 11, 671–684.
- Roediger, H.L., & Karpicke, J.D. (2006). *Test-enhanced learning: Taking memory tests improves long-term retention.* Psychological Science, 17(3), 249–255.
- Cepeda, N.J., Pashler, H., Vul, E., Wixted, J.T., & Rohrer, D. (2006). *Distributed practice in verbal recall tasks: A review and quantitative synthesis.* Psychological Bulletin, 132(3), 354–380.
- MacLeod, C.M., Gopie, N., Hourihan, K.L., Neary, K.R., & Ozubko, J.D. (2010). *The production effect.* Journal of Experimental Psychology: Learning, Memory, and Cognition, 36(3), 671–685.
- Cowan, N. (2001). *The magical number 4 in short-term memory.* Behavioral and Brain Sciences, 24(1), 87–114.
- von Restorff, H. (1933). *Über die Wirkung von Bereichsbildungen im Spurenfeld.* Psychologische Forschung, 18, 299–342.
- Symons, C.S., & Johnson, B.T. (1997). *The self-reference effect in memory: A meta-analysis.* Psychological Bulletin, 121(3), 371–394.
- Zheng, L., et al. (2023). *Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena.* [arXiv:2306.05685](https://arxiv.org/abs/2306.05685)

**Memory science (secondary readings)**
- [Forgetting curve — Wikipedia](https://en.wikipedia.org/wiki/Forgetting_curve)
- [The forgetting curve — Decision Lab](https://thedecisionlab.com/reference-guide/psychology/forgetting-curve)
- [Encoding, retrieval, and forgetting — Premier MCAT Prep](https://premiermcatprep.com/mcat-books/behavioral-sciences/memory-attention-and-cognition/encoding-retrieval-forgetting)
- [The forgetting curve — Structural Learning](https://www.structural-learning.com/post/ebbinghaus-forgetting-curve)

**Personal CRM landscape (2026)**
- [Top 10 Personal CRM Tools for 2026 — folk](https://www.folk.app/articles/best-personal-crm)
- [The Dex Guide to Finding the Right Personal CRM](https://getdex.com/guides/finding-the-right-personal-crm/)
- [Top 20 Personal CRM Tools 2026 — 1byte](https://blog.1byte.com/personal-crm-tools/)
- [Cloze CRM Review 2026 — Dex blog](https://getdex.com/blog/cloze-crm-review/amp/)
- [Best Personal CRM in 2026 — Orvo](https://www.getorvo.com/learn/best-personal-crm-2026)
- [Dex vs Clay (Mesh) 2026 — Dex blog](https://getdex.com/blog/dex-vs-clay/)
- [Streak CRM Review 2026 — Dex blog](https://getdex.com/blog/streak-crm-review-2026-using-a-gmail-crm-for-personal-networking/)

**AI memory & voice apps (2026)**
- [Best AudioPen Alternative 2026 — Remi8](https://remi8.ai/blog/voice-notes-2/audiopen-alternative-2026-remi8-94)
- [Best AI App for Voice Memos 2026 — Speakwise blog](https://speakwiseapp.com/blog/best-ai-app-voice-memos-2026)
- [Best AI Note Taker App 2026 — Remi8](https://remi8.ai/blog/voice-notes-2/best-ai-note-taker-app-95)
- [AudioPen](https://www.audiopen.ai/)
- [VoiceNotes AI](https://www.getvoicenotes.app/)

---

*This whitepaper is a living document. It lives at [github.com/nathanvajdos/pocket-steve/blob/main/docs/whitepaper.md](https://github.com/nathanvajdos/pocket-steve/blob/main/docs/whitepaper.md). Pull requests welcome. Last updated May 2026.*
