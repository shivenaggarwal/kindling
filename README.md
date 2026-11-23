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
| `INSTANTLY_API_KEY` | High-volume sending through warmed mailboxes | Instantly → Settings → Integrations → API Keys (scope `all:all`). Needs a paid plan with API access. |
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

## High-volume sending (how Explee-style tools stay out of spam)

Sending thousands of cold emails a day without landing in spam takes three things:

1. **Many separate sending domains and mailboxes.** Never use your main domain. Each mailbox sends ~30 cold emails a day, so 1,000/day ≈ 33 mailboxes ≈ 11 domains with 3 mailboxes each, all with SPF, DKIM and DMARC.
2. **Continuous warm-up.** Mailboxes trade emails inside a large warm-up network (opened, rescued from spam, replied to) to build and keep their reputation.
3. **Disciplined sending.** Rotation across mailboxes, verified lists (bounces under ~2%), plain text with no tracking, one-click unsubscribe, and spam complaints under 0.3%.

Kindling delivers through **Instantly** for this layer (set `INSTANTLY_API_KEY`):

- **Sending infrastructure** page: buy **pre-warmed** domains and mailboxes, which can send the day you buy them, or new lookalike domains that Instantly warms up for you. You get a price quote first, and nothing is charged until you confirm. It also shows each mailbox's warm-up score, health and the total daily capacity.
- One Instantly campaign per segment. Each lead's three AI-written emails travel as custom variables (`{{kSubject}}`, `{{kEmail1}}`, `{{kFollowup1}}`, `{{kFollowup2}}`). Campaigns are plain text with open and link tracking off, a one-click unsubscribe header, and stop-on-reply.
- Only mailboxes with a warm-up score of 80 or more send. New ones join campaigns automatically once they get there.
- Replies, bounces and unsubscribes come back through a webhook (Connect reply events). Kindling also checks Instantly every 5 minutes as a backup. Kindling drafts each answer and sends it from the same mailbox, in the same thread.

Check once on your first live campaign, because the API docs leave them open:
- **Weekdays:** confirm the campaign schedule shows the right days in Instantly. Kindling assumes `"0"` = Monday; set `INSTANTLY_SUNDAY_FIRST=1` if it turns out to be Sunday.
- **Variables:** confirm the first email shows the personalised text, not `{{kEmail1}}`.

**Gmail** (connected via Google OAuth) remains available per project for low volume, and it's used for Google Calendar booking either way.

## Deliverability and compliance

- Fill in the **sender name and postal address** in each project's Settings. They go in the footer, along with the opt-out line. "Unsubscribe" and "not interested" replies, and bounces, are added to the do-not-contact list automatically.
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
src/lib/instantly/  Instantly API client (accounts, warm-up, campaigns, leads, Unibox, webhooks, DFY orders)
src/lib/google/     OAuth client, Gmail send/read, Calendar free/busy and events
src/lib/ai/claude.ts  Claude wrapper: web search/fetch, strict structured output, cost tracking
src/lib/jobs/       Postgres job queue, runner, serverless drain + scheduler tick
src/worker/         worker entrypoint (jobs + timers)
src/app/            dashboard (Next.js App Router)
src/lib/config.ts   product name and env (rename the product here)
```

Model: `claude-opus-5-5`, with server-side refusal fallbacks enabled (`fallbacks: "default"`).
