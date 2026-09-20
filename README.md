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

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Runs the app locally at http://localhost:3000 |
| `npm run db:verify` | Confirms all tables exist and are reachable |
| `npm run db:seed` | Creates/updates your seed business + availability |
| `npm run test:voice` | Simulates a real Twilio call to `/api/twilio/voice` (needs `npm run dev` running in another terminal) |
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
