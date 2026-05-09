# Steve

A memory trigger for the people you meet. Working title: Steve, after the conversation that started it.

**Live:** https://memory-trigger.vercel.app  
**Whitepaper:** [docs/whitepaper.md](./docs/whitepaper.md)

You meet someone interesting at the school carnival or the park. You talk into your phone for 20 seconds: *"Met a couple at the carnival, kid Malachi, dog Otis, from California, all tatted up."* The app pulls out the structured pieces and saves them to your account. Before your next event in that location, the app emails you a memory trigger — names, kids, pets, distinctive details — enough to spark your own memory before you walk in.

Built as a PWA so it installs to the iPhone home screen with no app store. Multi-user with magic-link email login. Daily cron scans each user's calendar and emails them a memory trigger before any event matching someone they've met.

## Stack

- Vanilla HTML / JavaScript frontend, no framework, native `fetch`
- PWA (manifest + service worker) for iOS home-screen install
- Vercel serverless functions for backend
- **Supabase** — Postgres database + magic-link email auth + row-level security
- **Resend** — transactional email (briefings, magic links via Supabase)
- **Google Gemini 2.5 Flash** — voice memo extraction + briefing generation + event matching
- **Vercel Cron** — daily calendar scan (8am Central)

## Architecture

```
[ Steve's iPhone PWA ]
        |
        | https
        v
[ Vercel ]
  ├── /                       static UI
  ├── /api/config             expose Supabase URL+anon key to client
  ├── /api/extract            Gemini: voice memo -> structured fields
  ├── /api/brief              Gemini: heading-to-X -> matching briefings
  ├── /api/entries            CRUD (RLS-scoped to current user)
  ├── /api/profile            user profile incl. calendar_ics_url
  └── /api/calendar-scan      cron: daily pull each user's calendar,
                              fuzzy-match upcoming events to entries,
                              email matching memory triggers
        |
        v
[ Supabase ]                  auth.users, profiles, entries, nudges_sent
[ Resend ]                    outbound email
[ Gemini ]                    LLM
```

## Local dev

```bash
npm install
cp .env.example .env.local
# Fill in the env vars (see .env.example)
npx vercel dev
```

Open `http://localhost:3000`.

## Required env vars

| Name | Where it comes from | Used by |
|---|---|---|
| `GEMINI_API_KEY` | https://aistudio.google.com/app/apikey | extract, brief, calendar-scan |
| `SUPABASE_URL` | Supabase project settings -> API | _supabase, config |
| `SUPABASE_ANON_KEY` | Supabase project settings -> API | _supabase (user actions), config |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase project settings -> API (Service Role) | _supabase (cron only) |
| `RESEND_API_KEY` | https://resend.com/api-keys | _email |
| `RESEND_FROM_EMAIL` | e.g. `Steve <noreply@yourdomain.com>` | _email |
| `CRON_SECRET` | Random string (32+ chars). Vercel auto-passes as `Authorization: Bearer ...` | calendar-scan |

## Deploy

1. Push the folder to Vercel: `npx vercel --prod`
2. In **Vercel project -> Settings -> Environment Variables**, add all of the above for the **Production** environment.
3. In **Supabase -> SQL Editor**, run [`supabase/schema.sql`](./supabase/schema.sql).
4. In **Supabase -> Authentication -> URL Configuration**, set **Site URL** to your Vercel production URL and add it to **Redirect URLs**.
5. In **Resend -> Domains**, verify a sending domain (or use the default `onboarding@resend.dev` for testing).
6. Vercel Cron will fire `/api/calendar-scan` at 13:00 UTC daily (configured in [vercel.json](./vercel.json)).

## How a user uses it

1. Open the URL on iPhone Safari, tap **Share -> Add to Home Screen**. App icon now on the home screen.
2. Open the app. Enter email. Tap **Send magic link**. Check inbox, tap the link. Now signed in.
3. **Capture:** Tap *Just met someone* -> dictate via the keyboard mic -> hit save. Gemini extracts the structured details. Saved to their account.
4. **Manual recall:** Tap *Heading somewhere?* -> type the place -> see briefings for everyone they've met there.
5. **Auto recall:** In *Settings*, paste a public `.ics` calendar URL once. The app scans it daily; when an upcoming event matches a place where they've met someone, an email lands in their inbox with a 1–2 sentence trigger.

## Privacy

- Each user's entries are scoped to their `auth.uid()` via Postgres row-level security. Users cannot see each others' data.
- The frontend talks to Supabase using the **anon** key, which is designed to be shipped in browser code. The **service-role** key only lives in Vercel env vars, used by the cron job.
- Gemini calls send the memo text and entry list to Google for inference. We do not log requests on our side.
- The `.ics` calendar URL is fetched server-side by the cron only; the URL itself is stored in `profiles.calendar_ics_url`.

## To-do (post-launch)

- Replace SVG icon with proper PNG icon set
- Edit/delete UI for individual entries
- Export-to-text backup
- Per-user opt-in for email frequency
- Hardening: rate-limit `/api/extract` and `/api/brief` per user
- Custom domain
