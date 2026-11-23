# Kindling

An AI outbound agent. Give it a website and it:

1. **Learns what you sell.** It reads the site and builds a business profile, then finds competitors.
2. **Works out who buys it.** It proposes customer segments, each with a fit score, the reason they'd buy, an opening angle, and targeting (titles, locations, keywords, Google Maps queries).
3. **Finds those exact people.** It searches every source you've configured in parallel: AI web research (Claude with web search), Apollo, Hunter and Google Maps. Results are de-duplicated by domain, one decision maker is picked per company, and emails are verified with Hunter.
4. **Writes each one a personal email.** For every lead it reads the company's homepage and writes a 3-step plain-text sequence.
5. **Sends and follows up.** It sends through your Gmail inside a sending window, with daily limits per mailbox and spacing between sends. Follow-ups go in the same thread and stop on any reply.
6. **Handles replies and books meetings.** It polls Gmail, classifies each reply, drafts an answer and, when a prospect agrees to a time, creates a Google Calendar event with a Meet link.
7. **Learns what works.** It tracks the real cost (every API call is logged) and the warm-lead rate per segment. On autopilot it tops up winning segments and pauses losing ones.

With autopilot **off** (the default), you approve every first email and every reply. With it **on**, the agent approves, sends, replies and books by itself.

## Run it locally

Requirements: Node 20+, pnpm, and PostgreSQL 14+.

```bash
pnpm install
cp .env.example .env          # then fill it in (see below)
createdb kindling             # or point DATABASE_URL at any Postgres
pnpm db:migrate
pnpm dev                      # web app on :3000 + background worker
```

Sign in with `APP_PASSWORD` from `.env`.

`pnpm dev` runs two processes: the Next.js app and the **worker** (`src/worker`). The worker runs the AI jobs, sends email every 45 seconds, polls for replies every 2 minutes, and re-scores segments every 15 minutes. Nothing goes out unless the worker is running.

## Keys

| Variable | Needed for | Where to get it |
|---|---|---|
| `ANTHROPIC_API_KEY` | **Required.** All AI steps | console.anthropic.com → API keys |
| `APOLLO_API_KEY` | Decision makers with verified emails | Apollo → Settings → Integrations → API. The key needs access to `mixed_people/api_search` (free) and `people/bulk_match` (1 credit per revealed email). |
| `HUNTER_API_KEY` | Emails at a domain and verification | hunter.io → API |
| `GOOGLE_PLACES_API_KEY` | Local businesses from Google Maps | Google Cloud → enable **Places API (New)** → Credentials |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Gmail sending, reading replies, and Calendar booking | See below |

Each lead source is optional. AI web research always runs, and every other source runs only when its key is set.

### Google OAuth (Gmail and Calendar)

1. In Google Cloud Console, create a project and enable the **Gmail API** and the **Google Calendar API**.
2. Set up the **OAuth consent screen**:
   - With Google Workspace, choose **Internal**. No verification is needed and tokens don't expire.
   - Otherwise choose **External** and add each sending address as a **test user**. In "Testing" mode, Google expires refresh tokens after 7 days, so you'll need to reconnect weekly until the app is verified.
3. Create an **OAuth client ID** of type **Web application** with this authorised redirect URI: `http://localhost:3000/api/google/callback` (or `${APP_URL}/api/google/callback`).
4. Put the client ID and secret in `.env`, restart, then go to **Mailboxes & integrations → Connect Gmail** and tick every permission.

Scopes requested: `gmail.send`, `gmail.readonly`, `calendar.events` and `calendar.freebusy`. Refresh tokens are stored encrypted with `APP_SECRET`.

## Deliverability and compliance

- **Send from a separate domain** (e.g. `getacme.com`), not your main one, and set up SPF, DKIM and DMARC.
- **Warm new mailboxes up**: start at 10–20 emails a day and raise the limit slowly. Add more mailboxes to get more volume.
- The default sequence is plain text, has no links in the first email, sends one email at a time per mailbox at least 4 minutes apart, and adds a `List-Unsubscribe` header.
- **Fill in the sender name and postal address** in each project's Settings. They go in the footer, along with the opt-out line. "Unsubscribe" and "not interested" replies, and bounces, are added to the do-not-contact list automatically.
- Cold B2B email is legal in the US (CAN-SPAM) and, under "legitimate interest", in the UK/EU (PECR/GDPR) when it's relevant to the recipient's role, identifies you, and honours opt-outs. Check the rules for the countries you target.

## Deploy to Vercel

Kindling runs on Vercel without a separate worker:

- **When you click something** (create a project, find leads, approve emails), the work starts right away in the background via `after()`, for up to 5 minutes per request.
- **Scheduled work** (sending due emails, checking for replies, autopilot) runs through `/api/cron/tick`, which is protected by `CRON_SECRET`:
  - **Hobby plan:** Vercel Cron can only run once a day, so `.github/workflows/scheduler.yml` pings the endpoint every 5 minutes. That's free for public repos. Add the repository secrets `APP_URL` and `CRON_SECRET`.
  - **Pro plan:** change the schedule in `vercel.json` to `* * * * *` and you can delete the GitHub workflow.

Steps:

1. Import the repo in Vercel, and add a Postgres database (e.g. **Neon** from the Vercel Marketplace, which sets `DATABASE_URL`).
2. Set the environment variables: `APP_PASSWORD`, `APP_SECRET`, `CRON_SECRET`, `ANTHROPIC_API_KEY`, plus any lead-source and Google keys. `APP_URL` defaults to the production domain.
3. Deploy. The `vercel-build` script runs the database migrations before `next build`.
4. In Google Cloud, add `https://<your-domain>/api/google/callback` as an authorised redirect URI.

## Self-hosting with a worker

```bash
pnpm build
pnpm start      # web
pnpm worker     # worker, as a separate long-running process
```

Run **one** worker process. Jobs are claimed with `FOR UPDATE SKIP LOCKED`, so a second worker won't double-process jobs, but sending limits are only enforced within a single worker. Set `APP_URL` to the public URL and add the matching redirect URI to the Google OAuth client.

## Where things live

```
src/lib/pipeline/   analyze → segments → leads → write → send → replies → stats (autopilot)
src/lib/sources/    apollo, hunter, places, site crawler
src/lib/google/     OAuth client, Gmail send/read, Calendar free/busy and events
src/lib/ai/claude.ts  Claude wrapper: web search/fetch, strict structured output, cost tracking
src/lib/jobs/       Postgres job queue, runner, serverless drain + scheduler tick
src/worker/         worker entrypoint (jobs + timers)
src/app/            dashboard (Next.js App Router)
src/lib/config.ts   product name and env (rename the product here)
```

Model: `claude-opus-5-5`, with server-side refusal fallbacks enabled (`fallbacks: "default"`).
