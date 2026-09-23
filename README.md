# Pickup — runbook

A missed-call-to-booked-job SMS product for home service businesses. Full
product spec: [`SPEC.md`](./SPEC.md). This README is the operational
runbook — how to deploy it, add a client, rotate keys, and recover when a
text fails. It grows as each build phase lands.

## Status

Phase 1 done and verified against a real Supabase project: all 8 tables
exist, `/api/health` confirms live database connectivity, and one seed
business ("Queen City Comfort") with 20 weekly availability windows is in
the database.

Phase 2 done and verified end-to-end: `/api/twilio/voice` validates the
Twilio signature (confirmed a forged request gets rejected with 403),
writes every call to the `calls` table before doing anything else, returns
the TwiML greeting, and sends a real text-back SMS through Twilio. Not
live yet — no public webhook URL exists until Phase 7's deploy, so this
has only been proven with a simulated (but correctly signed) request
against a local dev server, not a real inbound phone call.

Phase 3 done and verified with a full simulated conversation: `/api/twilio/sms`
resolves the caller to a business (via an open lead, or the most recent
missed call), runs the Claude agent loop (`claude-sonnet-4-5`, the five
tools from SPEC.md, up to 4 tool calls per turn), and a real booking
happened — name, address, urgency, an offered slot, and a booked
appointment, with the owner's Live Line text sent and a lead score/est.
value computed in code (never by the model). Also verified: a frustrated
customer gets escalated to the owner, and killing the Anthropic key
produces the spec's required graceful fallback ("Got it — the owner will
text you shortly") instead of a crash. `send_payment_link` is a stub until
Phase 4 wires up real Stripe Checkout — it currently tells the customer
the deposit will be collected another way, which is a deliberate,
documented simplification, not a bug.

**One documented deviation from SPEC.md's literal wording:** the spec's
system prompt says to call `score_lead` "after the conversation is
complete," but `score_lead`'s own inputs (job type, urgency) are known
well before that, and the Owner Live Line needs a score *at booking time*.
The system prompt here calls `score_lead` right after qualifying the
customer, before offering slots, so `book_slot`'s Live Line always has a
real score. Also, `score_lead`'s `job_type` is constrained to
`replacement`/`repair`/`maintenance` (the three categories the spec's own
scoring formula uses), while `book_slot`'s `job_type` stays free text for
the human-readable appointment description.

**Phase 4 done and verified end to end, including real Stripe Connect:**
`/api/stripe/webhook` handles deposit payments and new client signups, and
`send_payment_link` creates real Stripe Checkout sessions. This goes
beyond SPEC.md's original Phase 1 design in one deliberate way:
**deposits route directly to each client's own bank account via Stripe
Connect**, not into your account. SPEC.md's own plan was to collect all
deposits into your account and pay clients out manually every Friday,
deferring real Stripe Connect as "about a day of work" for later — but
that means real client money would sit in your account, which isn't
something you want to ask a client to accept. So Stripe Connect is built
now instead: every new client gets their own Stripe Express account (a
short one-time "how do you want to get paid" link, texted to them right
after they sign up), and no deposit can be collected for a client until
they've completed it — `send_payment_link` checks this and gracefully
tells the customer "the deposit will be collected another way" if it's
not done yet, rather than ever routing money to the wrong place. Verified
with a real test-mode Connect account (onboarding, `account.updated`
activation, a real $89 test payment with card 4242 4242 4242 4242) — the
resulting PaymentIntent's `transfer_data.destination` was confirmed to
match the client's own connected account, and the webhook correctly
flipped the appointment to `confirmed`. See "Stripe setup" below for what
this requires

**Two more Stripe API changes discovered and fixed during testing** (both
very recent, not documented in most references yet): Stripe now blocks
the classic Connect account-creation method by default for new
integrations (fixed by enabling "Accounts v1 support" in your dashboard —
see "Stripe setup"), and newer accounts have "Managed Payments" on by
default, which is incompatible with Connect destination charges (fixed in
code — `send_payment_link` explicitly disables it per-session).
from you.

## One-time setup

1. Copy the env template and fill it in as you get each key:
   ```
   cp .env.local.example .env.local
   ```
2. Install dependencies:
   ```
   npm install
   ```
3. Create the database tables — open your Supabase project, go to
   **SQL Editor → New query**, paste the contents of
   `supabase/migrations/0001_init.sql`, and click **Run**. (We do it this
   way, not from a script, because the service-role key can read/write
   rows but cannot create tables — only the SQL Editor or a database
   password can, and we deliberately never ask you for the database
   password.)
4. Verify the tables exist:
   ```
   npm run db:verify
   ```
   You should see `OK` next to all 8 table names.
5. Seed your own test business (used by every test script in this repo):
   ```
   npm run db:seed
   ```
6. When you get to Phase 4, also run the second migration the same way —
   SQL Editor → paste `supabase/migrations/0002_stripe_connect.sql` → Run.

## Stripe setup (Phase 4)

Three things only you can do, in the Stripe Dashboard, before Phase 4's
tests can run:

1. **Enable Connect.** Go to Dashboard → search "Connect" → click "Get
   started." Answer the platform-profile questions and accept the Connect
   agreement. This unlocks creating connected accounts for your clients —
   without it, nothing in Phase 4's Stripe Connect code will work.
2. **Get your test-mode secret key.** Make sure the toggle in the top-right
   of the Dashboard says "Test mode," then Developers → API keys → reveal
   the "Secret key" (starts with `sk_test_...`). Paste it to me when asked.
3. **Create a webhook endpoint** (once you have a real deployed URL — this
   is a Phase 7 step, not needed for local testing): Developers → Webhooks
   → Add endpoint. Check **"Also listen for events on Connected
   accounts"** — easy to miss, but it means one endpoint and one signing
   secret handle both deposit payments and Connect onboarding events,
   instead of needing two. Select `checkout.session.completed` and
   `account.updated` as the events to send.

For local testing before you have a deployed URL, I generate my own
temporary webhook secret and simulate Stripe's webhook deliveries myself
(signed the same way Stripe signs them) — you don't need to do anything
for that part.

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app locally at http://localhost:3000 |
| `npm run db:verify` | Confirms all tables exist and are reachable |
| `npm run db:seed` | Creates/updates your seed business + availability |
| `npm run test:voice` | Simulates a real Twilio call to `/api/twilio/voice` (needs `npm run dev` running in another terminal) |
| `npm run test:sms` | Runs a full simulated booking conversation through `/api/twilio/sms` (needs `npm run dev` running) |
| `npm run test:stripe` | Tests the deposit-paid and new-client-signup webhook flows (needs `npm run dev` running) |
| `npm run test:stripe-connect` | Walks through Stripe Connect onboarding for the seed business and confirms a deposit routes to it (needs `npm run dev` running; prints a URL for you to open once) |
| `npm run lint` | Checks code style |
| `npx tsc --noEmit` | Type-checks the whole project |

## Adding a new client (fill in as later phases land)

This section will cover: Stripe subscription checkout → `businesses` row
created → text-based onboarding → carrier call-forwarding setup → go-live
checklist. Not built yet (Phases 4–7).

## Rotating keys (fill in as later phases land)

This section will cover rotating each of `SUPABASE_SERVICE_KEY`,
`TWILIO_AUTH_TOKEN`, `ANTHROPIC_API_KEY`, and `STRIPE_SECRET_KEY` /
`STRIPE_WEBHOOK_SECRET` without downtime. Not built yet.

## When a text fails (fill in as later phases land)

This section will cover what happens if the Anthropic API is down (the
customer gets a graceful fallback text and the owner is alerted — see the
Phase 3 test plan in SPEC.md) and how to check the `events` table for the
failure. Not built yet.

## Deploying (fill in in Phase 7)

Not built yet — Phase 7 covers pushing to Vercel, setting production env
vars, and pointing Twilio/Stripe webhooks at the production URL.
