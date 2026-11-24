# AI Company — 36-agent operating system

**0 employees. 36 AI agents. 1 central intelligence.**

An operational platform where six departments of specialised Claude agents research, create, publish, talk to the community, sell, and improve themselves — while you approve what matters from one command center.

Nothing in the UI is mocked: every number comes from the database, every activity-feed line is a real execution event, and every integration either performs a real official-API call or reports itself as disconnected.

---

## Quick start

Requirements: Node 20+ and PostgreSQL 14+.

```bash
cp .env.example .env.local        # then fill in the values below
npm install
npm run setup                     # migrate + seed the 36 agents and 5 workflows
npm run dev                       # web app on http://localhost:3000
npm run worker                    # background worker (separate terminal) — required
```

Minimum `.env.local`:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `ADMIN_PASSWORD` | Owner login password |
| `SESSION_SECRET` | ≥ 32 random chars, signs the session cookie |
| `ENCRYPTION_KEY` | 64 hex chars — encrypts credentials saved in the UI. Generate: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `ANTHROPIC_API_KEY` | Required for agents to think (or save it on the Integrations page) |
| `APP_URL` | Public URL — platforms fetch media from `APP_URL/media/...` when publishing |
| `APP_TIMEZONE` | IANA zone for schedules and the briefing (e.g. `Europe/Brussels`) |

Then, in the app:

1. **Integrations** → connect Anthropic (and anything else you have).
2. **Knowledge** → fill in objectives, brand, audience, products and tone. Agents are instructed not to invent business facts, so this is what makes their work yours.
3. **Settings** → business profile, approval policy, monthly AI budget, briefing time.
4. **Workflows** → the five default workflows are installed **paused**; enable the ones you want.
5. **Command center** → give the company an objective. The CEO Agent plans it and delegates.

## Deploy online (Render, one click)

`render.yaml` describes the whole stack: web app, background worker and PostgreSQL.

1. Sign in at https://dashboard.render.com with GitHub and allow Render to access this repository.
2. **New → Blueprint** → select this repository → Render reads `render.yaml`.
3. Fill in the two prompted values: `ADMIN_PASSWORD` (your login) and `ANTHROPIC_API_KEY`. `SESSION_SECRET` and `ENCRYPTION_KEY` are generated for you.
4. **Apply**. On first start the worker migrates the database and installs the 36 agents and default workflows.
5. Open the `ai-company-web` URL (`https://ai-company-web-….onrender.com`) and sign in.

Cost on Render: web (starter) + worker (starter) + Postgres (basic-256mb) ≈ $20/month, plus your Claude API usage (capped by the monthly budget in Settings).

## What's inside

### The 36 agents (`src/server/agents/catalog.ts`)

| Research | Content | Publish | Community | Sales | The Loop |
|---|---|---|---|---|---|
| Trend Scout | Visual Designer | Content Scheduler | Comment Monitor | Lead Finder | CEO Agent |
| Audience Listener | Carousel Builder | TikTok Publisher | Response Writer | Lead Qualifier | Task Router |
| Competitor Watch | Voiceover Producer | Instagram Publisher | DM Assistant | Outreach Writer | Quality Controller |
| Poll Writer | Video Editor | YouTube Publisher | Sentiment Analyst | Follow-up Assistant | Memory Manager |
| Market Analyst | Brand Guardian | X Publisher (+LinkedIn) | Community Builder | CRM Manager | Performance Analyst |
| Email Intelligence | Approval Manager | Newsletter Publisher | Reputation Monitor | Sales Analyst | Loop Feeder |

Each agent has its own mandate, method and quality bar (system prompt), input/output contract, tool set, permission set, model, effort level, private memory, task history, cost and quality tracking. Everything is editable per agent in the UI; `npm run db:seed -- --reset-agents` restores the catalog defaults.

### Architecture

```
Next.js (App Router, RSC + server actions)  ──►  PostgreSQL (Drizzle ORM)
        │  SSE /api/stream (live events)              ▲
        ▼                                             │
   pg-boss queues  ◄──────────────────────────  Worker (npm run worker)
   (in Postgres: jobs, retries, cron)                 │
                                                      ├─ Agent runner → Claude Messages API (tool loop)
                                                      ├─ Workflow engine (DAG, conditions, gates, delays)
                                                      ├─ Schedules (workflows, briefing, publish sweep, metrics)
                                                      └─ Approved-action executor → official platform APIs
```

- **Agent runner** (`src/server/agents/runner.ts`): streaming Messages API loop with adaptive thinking, per-agent model/effort, prompt caching, server-side refusal fallbacks, server tools (web search / web fetch) plus 30 company tools. Every model turn, tool call and result is written to the task's execution trace. Token usage and cost are recorded per task. Retryable failures (429/5xx/network) back off and retry up to 3 attempts; tasks parked while an agent is deactivated; a monthly budget cap stops new work.
- **Tools** (`src/server/tools/index.ts`): permission-checked at run time — knowledge search, memory, agent-to-agent messages, delegation with dependencies and duplicate detection, quality review with automatic revision tasks, content pipeline, media generation, scheduling, publishing, comments, replies, leads, email, CRM sync, metrics, workflow proposals.
- **Agent communication**: `send_message` inbox per agent, `delegate_task` with `dependsOn` (blocked tasks release when dependencies complete; failures cascade).
- **Memory**: shared knowledge base + company memory (always-on core context, plus `search_knowledge`), private per-agent memory, and your approval notes stored as preferences.
- **Workflows** (`src/server/workflows/engine.ts`): DAG with parallel fan-out/fan-in, conditions (text/structured-data/status with yes/no branches), approval gates, delays; manual, cron (timezone-aware) or event triggers (`content.published`, `task.failed`, `lead.created`, …). Upstream outputs flow into downstream steps. Runs are serialised per run with advisory locks. Visual builder with live run overlay at `/workflows/[id]`.
- **Human control** (`src/server/actions.ts`): publishing and external communication go through `requestOrExecute`, which follows your approval policy. Outbound email **always** requires approval. Everything is recorded in the approvals table and the audit log (Settings).
- **Morning briefing** (`src/server/briefing.ts`): aggregates the last 24h from the database (no generated numbers); optionally the CEO Agent writes a short narrative over that data. Scheduled daily; delivered in-app, by email (Resend) and/or Slack.
- **Security**: single-owner auth (password → signed HttpOnly JWT cookie, middleware + per-action checks), credentials encrypted with AES-256-GCM or read from env, never sent to the browser. Media files are served from unguessable URLs so platforms can fetch them.

## Integrations and the credentials they need

| Integration | Used for | Credentials |
|---|---|---|
| Anthropic | All agent reasoning, web search/fetch, PDF transcription | `ANTHROPIC_API_KEY` |
| OpenAI Images | Image generation (gpt-image-1) | `OPENAI_API_KEY` |
| ElevenLabs | Voiceovers | `ELEVENLABS_API_KEY`, optional `ELEVENLABS_VOICE_ID` |
| X | Posts/threads, mentions, replies, metrics | OAuth 2.0 user token with `tweet.read tweet.write users.read` → `X_ACCESS_TOKEN` |
| Instagram | Posts, carousels, Reels, comments, insights | Instagram Graph API long-lived token + business user id (`INSTAGRAM_ACCESS_TOKEN`, `INSTAGRAM_USER_ID`). Needs public media URLs (`APP_URL`). |
| LinkedIn | Posts | Token with `w_member_social` + author URN |
| TikTok | Video publishing (Content Posting API, PULL_FROM_URL) | User token with `video.publish`. Unaudited apps may only post `SELF_ONLY`; set `TIKTOK_PRIVACY_LEVEL` once audited. The video URL's domain must be verified in the TikTok developer portal. |
| YouTube | Uploads, statistics, comments | OAuth token with `youtube.upload`, `youtube.force-ssl` |
| Resend | Outreach email, newsletter broadcasts, briefing email | `RESEND_API_KEY`, `RESEND_FROM` (verified domain), optional `RESEND_AUDIENCE_ID`, `BRIEFING_EMAIL_TO` |
| Slack | Notifications & briefing | Incoming webhook URL |
| HubSpot | Lead sync | Private-app token with contacts read/write |

Each card on the Integrations page shows connection status, permissions, credential source, last successful sync and the last error, with a live **Test connection** button.

## Honest limitations

- **OAuth refresh**: platform tokens are entered as access tokens. X (2h) and YouTube (1h) access tokens expire; until an OAuth refresh flow is added, use long-lived tokens where the platform offers them (Instagram, LinkedIn) and re-enter short-lived ones when the integration card shows an auth error.
- **Video**: Video Editor produces edit decision lists; it does not render video. Attach a finished video URL to a content item (content page → Assets) before TikTok/Reels/YouTube publishing.
- **Engagement metrics** are fetched for X, Instagram and YouTube; TikTok, LinkedIn and newsletter metrics are not read back.
- **Single owner**: one login, no multi-user roles yet.
- **Media** (generated images/audio) is stored in PostgreSQL so the web app and worker can run on separate servers.

## Scripts

| Command | |
|---|---|
| `npm run dev` / `npm run build && npm start` | Web app |
| `npm run worker` | Background worker (run it in production too — e.g. a second process/container) |
| `npm run db:generate` / `npm run db:migrate` | Schema migrations |
| `npm run db:seed` | Install agents & default workflows (idempotent) |
| `npm run typecheck` / `npm run lint` | Checks |

Configurable: `WORKER_CONCURRENCY` (default 4 parallel agent tasks), `AI_COMPANY_ANTHROPIC_BASE_URL` (gateway/proxy).

## Project map

```
src/
  app/(app)/          pages: command center, morning page, approvals, workflows, tasks,
                      departments, agents, content, community, leads, knowledge, integrations, settings
  app/actions.ts      every mutation (server actions, auth-checked, audited)
  app/api/stream      SSE live event stream        app/media/[name]  public media
  components/         design system (ui.tsx), loop map, activity feed, shell
  db/                 schema.ts, seed.ts
  server/agents/      catalog (36 agents) + runner
  server/tools/       agent tools
  server/workflows/   workflow engine
  server/integrations registry (credentials) + providers (official API clients)
  server/briefing.ts  morning briefing        server/metrics.ts  KPIs
  worker/index.ts     background worker
```
