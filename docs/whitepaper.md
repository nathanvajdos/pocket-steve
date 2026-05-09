# Pocket Steve — A Memory Trigger for the People You Meet

*A whitepaper on the science, the competition, and the moat.*

> *"I was at this thing at the elementary school today, and I met this couple. I got his name, I got her name, and I got their kid's name, and then a couple of key qualities — they had a little pug, real cute little pug. As I was leaving, I thought: within a day or two I will forget all that."*
>
> &mdash; Steve, May 2026, the conversation that started this app

---

## 1. The problem in one paragraph

Adults forget the names, kids, pets, and distinctive details of the people they meet at social and professional events within hours. The cost is silent but real: trust is built on remembering. The person who walks up to a casual acquaintance six months later and says *"How's Malachi doing?"* creates a small but durable bond. The person who blanks does not. Existing tools — personal CRMs, note apps, voice memo apps — either treat this as a database problem (search a list) or a habits problem (remember to log it). Neither solves it. Both make the user do the work the brain is already failing to do.

**Pocket Steve treats the problem as a *memory trigger* problem.** Capture has to be near-zero effort (voice, photo, no fields). Recall has to be proactive (the app surfaces who you might see *before* you walk into the next event), and it must give just enough cue to spark the user's own memory rather than dump a database row at them. The product's job is to be the spark, not the warehouse.

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

Pocket Steve indexes by `where_met` first because that's the cue most likely to fire when the user is heading back to that place. Every other field exists to deepen the cue, not to be searched as a database.

### 2.3 Cue-dependent forgetting (Tulving)

The "tip of the tongue" experience proves a key truth: **most "forgotten" memories aren't gone, they're just unreachable without the right cue.** Recognition hits 90%+ accuracy where free recall fails. ([structural-learning.com](https://www.structural-learning.com/post/ebbinghaus-forgetting-curve))

Pocket Steve's recall flow ("Heading somewhere?") is a recognition task, not a recall task. The user types a place; the app surfaces a card; the user recognizes the people instantly. The brain does the heavy lifting from there. This is why the briefing only needs to be **two or three sentences** — it's a spark, not a transcript.

### 2.4 Levels of processing (Craik & Lockhart, 1972) and dual coding (Paivio, 1971)

Two related findings:

- **Deeper, more elaborative encoding produces more durable memory.** Saying "the couple from California" is shallower than saying "the couple from California with the pug named Otis whose son is named Malachi" — the latter creates more retrieval pathways.
- **Visual + verbal encoding outperforms either alone** (dual coding). Snapping a photo of a name tag plus dictating context creates two anchored memories.

This is why our `/api/extract` and `/api/extract-photo` endpoints fan out into structured fields (names, kids, pets, traits, where, raw text) rather than storing one blob. Every field is another retrieval pathway.

### 2.5 What the science tells us NOT to build

- **Don't build search-first UX.** Search punishes weak cues — the user has to already remember enough to find the entry. Recognition and proactive surfacing don't.
- **Don't fragment one person across many entries.** That fights the schema-completion mechanism. Per-person history (timeline) is the right structure.
- **Don't gamify, streak, or otherwise reward "use this every day."** The user opens the app at the moments dictated by their actual life (just met someone, heading somewhere). Anything that demands more frequent interaction creates friction without memory benefit.
- **Don't make the app a notebook.** Notebooks are open-ended; they punish brevity. Pocket Steve should reward 20-second voice dumps and never expect a 5-paragraph write-up.

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

**Synthesis.** Personal CRMs are competent at *maintaining* relationships you already know exist. They are weak at *encoding* relationships you don't know exist yet — the exact moment Pocket Steve targets. None of them are voice-first; all of them require the user to type into fields. None of them tie capture to *place* (where_met) as the primary index. None of them surface people based on *upcoming events* — they surface based on time-since-last-contact.

### 3.2 The AI memory & voice apps

| Tool | Pricing | Thesis | Notes |
|---|---|---|---|
| **[Mem.ai](https://mem.ai)** | $14.99/mo | AI-native personal knowledge | Powerful for general notes; not relationship-specific. |
| **[Voicenotes](https://voicenotes.com)** | Freemium | Voice-first AI notes you can ask | Closest in *capture pattern* to Pocket Steve. But the data model is conversation-first, not person-first. |
| **[AudioPen](https://audiopen.ai)** | $4-7/mo | Voice → polished text in any style | Excellent for writers/bloggers. Wrong shape for relationship memory. |
| **[Speakwise](https://speakwiseapp.com)** | Freemium | Voice → structured notes with Notion sync | Good polish; same gap as AudioPen — note-shaped, not person-shaped. |
| **[Remi8](https://remi8.ai)** | Freemium | Captures phone calls and FaceTime, transcribes, summarizes | More about meetings than meeting people. |
| **[Otter](https://otter.ai), [Granola](https://granola.ai)** | varies | Meeting transcription + summary | Adjacent — useful inside formal meetings, not at school carnivals. |
| **[Rewind](https://rewind.ai)** | $20/mo | Captures *everything* you do on a Mac | Mac-only, desktop-only. Wrong context. |

**Synthesis.** The voice-first AI memory category is full of excellent tools that *almost* solve the problem. They prove voice is the right modality and AI is the right transformation layer. But all of them are **note-shaped**: they index on the recording, not on the person. None of them do the "Heading somewhere? Here's who you've met there" recall flow.

### 3.3 The honest comparison: who is closest?

If we had to pick the single closest competitor, it's **Dex**. They've thought hardest about the relationship-management category. They have polish, integrations, and a paying user base.

The space between Dex and Pocket Steve:

- **Capture modality.** Dex is type-first with email/LinkedIn import. Pocket Steve is voice-first and photo-first. At a kids' school event, the user is not on LinkedIn — they're talking to a stranger holding a juice box. Voice + photo is the right modality for this moment; type + import is the wrong one.
- **Recall trigger.** Dex's reminders are time-based ("60 days since last contact"). Pocket Steve's are place-based and event-based ("you have a calendar event tomorrow at the elementary school where you met Dan and Sarah"). Place is a stronger encoding cue than time, per encoding specificity.
- **Audience.** Dex serves the LinkedIn-heavy professional. Pocket Steve serves the same person *and* the parent at the school carnival, *and* the salesperson at the conference. Wider net, lower per-user complexity.

---

## 4. The moat

A sharp wedge isn't enough. Below are the four mechanisms that, used together, make Pocket Steve durable.

### 4.1 The data moat (compounding switching cost)

Every saved person is a switching cost. After six months of use, a Pocket Steve user has 50–200 entries with rich context: who they met, where, with whom, what was distinctive. Migrating that to another tool is unattractive — even if a competitor matches the feature set, the user is choosing between *keep using Pocket Steve* and *re-build from zero somewhere else*. This is the same moat that retains Notion users despite cheaper alternatives.

We strengthen this by:

- Per-person history (already shipped) — relationships accumulate context over time, becoming individually irreplaceable.
- Future: relationship graph (who knows whom, who I met through whom) — once a user has built this graph, it cannot be reproduced.

### 4.2 The voice + photo capture combo

Most competitors offer one or the other, badly. Pocket Steve does both, well, and for the same data model. Photo-OCR pre-fills fields; voice adds context; the two compound (dual coding theory).

This is a genuinely defensible technical advantage in 2026 because:

- Gemini 2.5 Flash Vision (and the equivalent OpenAI/Anthropic models) finally make business-card OCR + speech transcription work at quality and latency that fit the moment.
- The composite UX (snap → talk → save in one screen) requires deliberate product design that most general-purpose tools won't bother with.

### 4.3 Calendar-driven proactive recall

This is the feature most likely to make the product feel magical and differentiate from every other personal CRM:

> *Steve has a calendar event Saturday at the elementary school. Pocket Steve has matched that event location to the place where Steve met Dan and Sarah three months ago. Saturday morning at 8am, Steve gets an email: "You're heading to the school today. Last time you were there you met Dan and Sarah — kid Malachi, dog Otis, all tatted up, from California."*

No personal CRM does this. The closest analog is Dex's pre-meeting briefs, which are generated only for events with explicit attendees — a corporate calendar pattern. Pocket Steve's nudges fire on *any* event matching a place where the user has met someone, including unstructured social events that have no attendee list.

Tooling: Microsoft Graph + Google Calendar OAuth + .ics share URL fallback. Already scaffolded in the v1 codebase.

### 4.4 Privacy as positioning

Every personal CRM competitor positions itself in some "professional networking" frame. Pocket Steve's positioning — *the parent at the elementary school carnival* — is emotionally distinct. We're not selling lead generation; we're selling presence. That has marketing implications:

- The category is not LinkedIn productivity — it's *the same family of products as* Calm, Headspace, Strava. Tools that help you be a better version of yourself.
- The privacy posture (no social, no team, no ads, your data is yours) is consistent with that positioning.
- The viral mechanism is one-on-one ("how did you remember Malachi's name?") rather than feed-driven.

---

## 5. Where we win, where we are vulnerable

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

## 6. Roadmap that strengthens the moat

This is a roadmap of *moat-deepening* features, not feature-of-the-week ideas. Each row asks: does this make Pocket Steve harder to replace?

| Phase | Feature | Why it deepens the moat |
|---|---|---|
| **v1 (shipped)** | Voice capture, photo OCR, edit/delete, per-person history, magic-link auth, calendar nudge framework, .ics URL fallback | Establishes the core capture-recall loop and per-person data shape |
| **v1.1** | LinkedIn paste-and-enrich | Captures the founder/sales wedge without becoming Dex; reduces capture friction further |
| **v1.2** | iCloud Calendar via signed-in iOS Shortcut (workaround for Apple's API gap) | Closes the iCloud user gap that competitors can't close either |
| **v1.3** | Relationship graph: "you met Dan via Sarah at the school" | Network effect on the data — irreproducible elsewhere |
| **v2** | Native iOS app with EventKit, Apple Watch glance, real push notifications | Brings the app into the moment — fewer users miss the nudge |
| **v2.1** | Spaced-rehearsal nudges based on the forgetting curve | Optional weekly "people you might want to remember" digest. Strengthens encoding without being demanding. |
| **v3** | Voice-first ambient capture via AirPods + Siri Shortcut | "Hey Siri, I just met..." — the highest-leverage capture moment. Wispr-Flow-equivalent friction reduction. |
| **v4** | Smart-glasses integration (Meta Ray-Bans, Apple Vision) with face-recognition + earbud whisper | Endgame. Genuinely transforms the capture-recall loop. |

Note that nothing on this list pivots us toward a sales CRM, a feed, an enterprise tier, or any of the natural drift that destroys focused products. Discipline is part of the moat.

---

## 7. Validation evidence and what we still need to learn

### 7.1 What's known to work (signal we already have)

- **Steve's own framing is the design spec.** A non-technical user described, unprompted, the exact mechanism the cognitive science literature would predict. The product matches what humans intuitively want.
- **Voice capture works on iPhone Safari** without permissions friction (browser-native SpeechRecognition).
- **Gemini 2.5 Flash extracts structured fields** from a voice memo with sub-3-second latency at zero marginal cost (free tier sufficient for hundreds of users).
- **The PWA installs cleanly on iOS** via Add to Home Screen — passes the "feels like an app" test.
- **The match-and-merge logic** correctly identifies re-meetings without false-positives (Gemini conservative threshold tuned in `/api/entries/match`).

### 7.2 What we still need to learn (highest-value open questions)

1. **Does the briefing actually trigger memory the way Steve described?** Steve himself is the n=1 trial. His feedback after two weeks is the deciding signal. If yes → the product works. If no → the recall flow needs more cues (photos, group context, relationship graph).
2. **How often do users hit the "snap a card" path vs. voice path?** That tells us whether the wedge is networking events or social/community events. The product copy and roadmap diverge sharply based on this answer.
3. **What's the true habit cadence?** If users open Pocket Steve once a week and forget it the rest of the time, the calendar nudge becomes the only retention mechanism — and it has to work without fail.
4. **Will users tolerate a manual calendar-share-URL paste?** Or do we need to ship Microsoft/Google OAuth before the second cohort?

These are answered by use, not by debate.

---

## 8. The principle that decides everything

When in doubt, the design rule is:

> **Be the spark, not the warehouse.**

If a feature increases capture friction, kill it. If a feature requires the user to remember something the app should remember for them, kill it. If a feature delivers a database row instead of a 2-sentence trigger, redesign it.

Speed and simplicity aren't aesthetics. They're the load-bearing wall. The moment Pocket Steve becomes another tool the user has to remember to use, we have lost — because we are competing with the human brain itself, and the brain wins by default.

Stay narrow. Ship sharp.

---

## Appendix A — Source map

**Memory science**
- [Forgetting curve — Wikipedia](https://en.wikipedia.org/wiki/Forgetting_curve)
- [Replication and analysis of Ebbinghaus's forgetting curve (PMC, 2015)](https://pmc.ncbi.nlm.nih.gov/articles/PMC4492928/)
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
