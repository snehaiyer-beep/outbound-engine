# Outbound Engine

Turns a list of company domains into a **human-approved** cold-email pipeline for Sprinto
(SOC 2 / ISO 27001 automation), then handles replies and books meetings.

Next.js (App Router) + TypeScript + Tailwind. One codebase. Runs fully offline on mock data.

## Run it

```bash
npm install
cp .env.example .env.local   # set API_TOKEN (12+ chars) and TEST_RECIPIENT
npm run dev                  # http://127.0.0.1:3000, sign in with API_TOKEN
```

Checks: `npm run typecheck`, `npm test` (66 offline tests), `npm run build`.

## Safety rules (enforced in code)

| Rule | Where |
|---|---|
| Every route needs the API token (Bearer, `x-api-token`, or login cookie); non-localhost `Host` headers are refused; no token configured = everything refused | `src/middleware.ts`, `src/lib/safety/auth.ts` |
| Server binds to 127.0.0.1 | `package.json` scripts (`-H 127.0.0.1`) |
| While `TEST_RECIPIENT` is set, **all** mail goes there. Real recipients need `TEST_RECIPIENT` empty **and** `LIVE_SENDING=true`; with neither, sending is blocked | `resolveRecipient` in `src/lib/safety/gates.ts` |
| One send path: `sendEmail()` checks every gate and reserves the send in one synchronous store write | `src/lib/safety/outbox.ts` |
| Cold emails need a human "Approve & Send" (`confirm: true`); autopilot can never send one | `checkSendGates`, `/api/drafts/[id]/approve` |
| Suppression list: opt-out replies are added automatically; suppressed addresses are never emailed; the list is add-only | `gates.ts`, `replies/process.ts`, `/api/suppression` |
| Every email ends with an unsubscribe line and has a `List-Unsubscribe` header | `withUnsubscribe`, `services/mailer.ts` |
| Daily send cap (`DAILY_SEND_CAP`) and at most one contact per company | `checkSendGates` |
| Reply-handling actions (slot proposals, bookings, CRM logs) wait for approval unless `AUTOPILOT=true` | `replies/actions.ts` |
| Every external service has an offline mock used when its key is blank (or `OFFLINE=true`) | `src/lib/services/*` |

## Pipeline

1. **Ingest** (`pipeline/scrape.ts`, `certs.ts`): fetches `/`, `/about`, `/careers`, `/security`, `/trust`.
   Looks for SOC 2 / ISO 27001 / HIPAA / PCI in *visible text*; if none, checks raw HTML
   (comments, image names/alt, script src and inline scripts). Also counts open roles and finds employee counts.
2. **Qualify** (`pipeline/qualify.ts`): the LLM returns JSON with a pass/fail and reason per rule:
   B2B software, 20+ employees, 3+ open roles, no visible certification. A rule can come back *undecided*,
   which makes the agent loop fetch more pages (`/company`, `/team`, `/jobs`, then `/customers`, `/pricing`) and ask again.
   A visible certificate found by the scraper always overrides the model. Disqualified companies show every failing reason.
3. **Contacts** (`pipeline/contacts.ts`): Hunter.io domain search, qualified companies only, max 5, ranked by role
   (security > compliance > CTO/eng > ops > CEO > ...).
4. **Draft** (`pipeline/draft.ts`, `lint.ts`): one email per contact plus two role pain points. Lint rules in code:
   under 90 words, greets by first name, first sentence states the gap, no flattery, no rhetorical questions,
   exactly one low-pressure ask. The LLM gets up to two retries with the lint failures; the dashboard lints live
   and blocks sending until it passes.
5. **Dashboard** (`src/components/Dashboard.tsx`): company table with rule ticks and disqualify reasons; side panel
   with evidence, ranked contacts, editable draft, Approve & Send, Reject (reason required).
6. **Learning loop** (`pipeline/learning.ts`): every saved edit (before/after) and every reject reason is stored.
   New drafts retrieve the 3-5 most similar past edits (TF cosine on role/gap/signals + text) and put them in the prompt.
7. **Replies** (`replies/*`): reads replies (Gmail IMAP or mock inbox), classifies them as interested / not interested /
   confirms a time / asks for another time / unclear. Interested → 3 calendar slots proposed; a pick → booking +
   confirmation + CRM log; another time → 3 new slots; unclear or silent (`SILENT_AFTER_DAYS`) → human queue.

## Added after comparing with another team's app

- **Funnel** on the Companies page: checked → good fit → needs your decision → emails ready → emailed → meetings booked (click a stage to filter).
- **Find leads**: search the web (Gemini + Google Search, up to 5 queries) or read a list page (startup directory); pick which to check.
- **Needs your decision**: if the agent still can't answer a rule after fetching more, it hands the company to a person (Qualify / Disqualify) instead of guessing.
- **To do** tab: companies to decide, emails to approve (best first), replies/bookings to OK.
- **Priority score** (0-100, every point explained) and a one-line "what they do" for each company; search and certificate-status filters.
- **Kill switch** (Settings): stops sending, booking, checking, searching and drafting at once. Kill criteria from the case trip it automatically:
  over 50% of emails rewritten/discarded, under 60% right-person rate ("Wrong contact" skips), or over 15 min review time per company.
- **Skip reasons** from a list (Wrong contact, Too generic, …) and a review timer feed those criteria and the learning loop.

## Services

| Service | Live (when key set) | Offline mock |
|---|---|---|
| LLM | Gemini (`GEMINI_API_KEY`, model fallback chain in `GEMINI_MODELS`), else Anthropic (`ANTHROPIC_API_KEY`). If every model fails (e.g. free-tier quota), that step falls back to the mock and says so | rule-based qualifier, template drafter, keyword classifier |
| Agent-loop web research | Gemini + Google Search, asked only when headcount or open roles are undecided; answer and sources shown as evidence | skipped |
| Job boards | Ashby / Greenhouse / Lever public APIs (board linked on the site, else a name guess labelled as a guess) | skipped |
| Contacts | Hunter.io (`HUNTER_API_KEY`) | fixture contacts for demo domains |
| Email send | Resend (`RESEND_API_KEY`, `RESEND_FROM`, `REPLY_TO`), else Gmail SMTP with an App Password | mock outbox in the store |
| Inbox | Gmail IMAP (same credentials) | mock inbox + "Simulate a reply" in the dashboard |
| Calendar | Cal.com v2 (`CALCOM_API_KEY`, `CALCOM_EVENT_TYPE_ID`) | business-hours slot generator with bookings |
| CRM | HubSpot notes (`HUBSPOT_TOKEN`) | mock CRM log |
| Scraper | live HTTP | fixture sites for the 6 demo domains (`src/lib/fixtures.ts`) |

The live adapters are written against each provider's public API but have **not** been exercised with real keys;
the mocks are what the tests cover.

Demo domains (all fictional): `acmeledger.io` and `orbitops.dev` qualify (OrbitOps needs the agent loop);
`vaultly.com` (SOC 2 visible), `brewbox.shop` (consumer), `tinytask.app` (too small), `medsync.health` (HIPAA visible) don't.

Data lives in `data/store.json` locally (delete it to reset). With `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` set it lives in the
private Supabase Storage bucket `outbound-engine`, with a lock object so writes never interleave across serverless instances
(`LIVE_SUPABASE=1 npx vitest run tests/live-supabase.test.ts` checks this).

## Deployment (Vercel)

Team **Mesa Ai Sprint**, project `outbound-engine`, deployed with `npx vercel deploy --prod`.
Live: https://outbound-engine-tau-sand.vercel.app (sign in with `API_TOKEN`).
`ALLOWED_HOSTS` must list the production hostname; any other host (including per-deployment URLs) is refused.
Badge images on a site (e.g. `/compliance/soc-2.svg`) count as a visible certification unless named pending/coming soon.
