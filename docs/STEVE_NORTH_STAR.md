# Steve's North Star

Single source of truth for product decisions. When a fork comes up — should I add X? remove Y? change A to B? — this is what the answer is measured against.

**The customer is Steve.** Not a persona. An actual person. A non-technical guy who described the product, unprompted, in a parking lot.

---

## 1. The exact moment that started this

Steve, walking back to his car after the elementary school carnival:

> "I just met this couple. Their dog is Otis, the kid is Malachi, they're from California, all tatted up. Within a day or two I will forget all of that. Is there some kind of an app where I can just say all that into my phone and the next time I see them at school it brings it all back up for me?"

That sentence is the spec. Every feature either makes that moment work better, or it doesn't belong.

The two halves of the moment are non-negotiable:

1. **Capture in the parking lot, hands-free, one-shot, no thinking.** He won't fill out a form. He won't tag fields. He'll talk for 10 seconds while walking to his car, and that's it.
2. **Recall before the next encounter, surfaced not searched.** He won't remember to open the app and search. The app has to find *him* — through a place name he types ("school carnival," "lake house") or a calendar event that matches.

If a feature lives outside those two halves, it is drift.

---

## 2. The principle ladder (in priority order)

When two principles seem to conflict, the higher one wins.

1. **Be the spark, not the warehouse.** Steve doesn't want a database row, a contact card, or a CRM entry. He wants 2 sentences that bring the person back to mind. If a feature delivers more, it's failing — not succeeding.

2. **Falcon-9, not Raptor-9.** Remove parts before adding parts. Every input field, every fold, every button is a tax on the parking-lot moment. The brain has limited capacity (Cowan, 2001 — ≈4 chunks). The UI must respect that.

3. **Lead with the atypical.** Memory science (von Restorff effect): the distinctive detail is what triggers recall. Otis the dog beats "has a dog." Tatted-up beats "California." Steve already knew this — his original framing led with the dog's name. The product must do the same in every brief.

4. **Encoding specificity.** Tulving (1973): retrieval works best when the cue at recall matches the context at encoding. "School carnival" is the cue. The brief must lead with the place, not the name, not the date.

5. **Discipline is the moat.** Every competitor (Dex, Clay, Monaru, Personal CRM) drifted into being a relationship database. Steve's product wins by *not* drifting. The moment we add a feed, a tag system, a follow-up reminder cadence, a sales pipeline, an enterprise tier — we have lost.

6. **Privacy-first by structure.** Voice never leaves the device unencrypted. Photos OCR client-side where possible. Calendar nudges run on a one-way fetch (we read .ics, never write). This is not a marketing claim, it is a moat — Apple, Google, and every CRM cannot say the same.

---

## 3. The decision rubric

Every fork — feature, microcopy, removal, refactor — runs through these in order. Stop at the first **no**.

1. **Does it serve the parking-lot moment?** (capture in 10 sec hands-free, OR recall before next encounter, surfaced)
2. **Does it remove friction or add it?** (Falcon-9: removing > adding)
3. **Does it lead with the atypical detail?** (von Restorff)
4. **Does it match the encoding cue?** (place, person, time-of-meeting — not metadata)
5. **Does it strengthen the moat or dilute it?** (discipline > breadth)
6. **Does it preserve privacy-by-structure?** (no new data exits the device that didn't already)
7. **Can a non-technical Steve use it without instruction?** (zero-cognitive-load test)

If a fork passes 1–7, ship it. If it fails any, the answer is no — even if it's clever, even if it's free, even if competitors have it.

---

## 4. The "what would Steve say" test

When in doubt, imagine handing the change to Steve in a parking lot and watching him use it for the first time. Two questions:

- Would he understand what to do without being told?
- Would the brief, when it surfaces next time, make him say *"oh yeah, the tatted-up couple from California with the dog Otis"*?

If either answer is *probably not*, the change is wrong. Try a smaller version, or kill it.

---

## 5. Decisions Steve has already implicitly made

These are settled. Don't relitigate without new evidence.

- **No signup screens, no password fields.** Anonymous-first. Magic-link upgrade later.
- **Voice and photo are peers.** Neither dominates. Photo for badges/cards at conferences, voice for everything else.
- **No tag system, no folders, no "categories."** Place is the only organizing principle.
- **No social graph, no sharing, no "see what friends remembered."** This is private memory, not a network.
- **No AI chatbot interface.** Steve doesn't want to converse with an LLM. He wants to be reminded.
- **One brief is enough.** Not three suggested briefs. Not "ranked." One — for the place he typed.
- **Apple/Ive feel, not dev-product feel.** Light theme, refined typography, generous whitespace. The opposite of a dashboard.

---

## 6. When this document is wrong

This doc is wrong when Steve himself says it is. He is the n=1 trial. His feedback after using the product is the only signal that should change the principle ladder. Until then, it stands.

If something on this page conflicts with a later directive from Nathan (Steve's friend, the person shipping this), Nathan's directive wins — but the conflict gets logged as a delta to this doc, so the principle ladder stays internally consistent over time.
