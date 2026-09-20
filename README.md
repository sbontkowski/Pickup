# Pickup — runbook

A missed-call-to-booked-job SMS product for home service businesses. Full
product spec: [`SPEC.md`](./SPEC.md). This README is the operational
runbook — how to deploy it, add a client, rotate keys, and recover when a
text fails. It grows as each build phase lands.

## Status

Phase 1 done: app scaffold, database schema, seed script. Not live yet —
no Twilio, agent, or Stripe wiring exists until later phases.

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
