-- Pickup Phase 1 schema.
-- Run this once in the Supabase SQL Editor (Dashboard > SQL Editor > New query > paste > Run).
-- Safe to re-run: every statement is idempotent.

create extension if not exists pgcrypto;

-- Shared trigger that keeps updated_at current on every UPDATE.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- businesses ----------------------------------------------------------------
create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_name text,
  owner_cell text,
  forward_number text,
  timezone text not null default 'America/New_York',
  facts jsonb not null default '{}'::jsonb,
  deposit_cents integer not null default 0,
  deposit_label text,
  stripe_customer_id text,
  plan text not null default 'catch' check (plan in ('catch', 'answer')),
  status text not null default 'trial' check (status in ('trial', 'active', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on businesses;
create trigger set_updated_at before update on businesses
  for each row execute function set_updated_at();

-- availability ----------------------------------------------------------------
create table if not exists availability (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  weekday integer not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  slots_per_window integer not null default 1,
  window_minutes integer not null default 120,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on availability;
create trigger set_updated_at before update on availability
  for each row execute function set_updated_at();

-- calls ----------------------------------------------------------------
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid references businesses(id) on delete cascade,
  caller_phone text,
  twilio_call_sid text,
  caller_type text not null default 'unknown' check (caller_type in ('human', 'ai_agent', 'unknown')),
  missed_at timestamptz,
  texted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on calls;
create trigger set_updated_at before update on calls
  for each row execute function set_updated_at();

-- leads ----------------------------------------------------------------
create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  phone text not null,
  name text,
  address text,
  zip text,
  job_type text,
  urgency text check (urgency in ('emergency', 'soon', 'flexible')),
  summary text,
  score integer check (score between 0 and 100),
  status text not null default 'new' check (status in ('new', 'qualifying', 'booked', 'confirmed', 'escalated', 'lost')),
  est_value_cents integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on leads;
create trigger set_updated_at before update on leads
  for each row execute function set_updated_at();

-- messages ----------------------------------------------------------------
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  role text not null check (role in ('customer', 'agent', 'owner', 'system')),
  body text not null,
  twilio_sid text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on messages;
create trigger set_updated_at before update on messages
  for each row execute function set_updated_at();

-- appointments ----------------------------------------------------------------
create table if not exists appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'held' check (status in ('held', 'confirmed', 'cancelled', 'completed')),
  deposit_status text not null default 'none' check (deposit_status in ('none', 'sent', 'paid')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on appointments;
create trigger set_updated_at before update on appointments
  for each row execute function set_updated_at();

-- payments ----------------------------------------------------------------
create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references appointments(id) on delete cascade,
  stripe_session_id text,
  amount_cents integer not null,
  status text not null default 'pending',
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on payments;
create trigger set_updated_at before update on payments
  for each row execute function set_updated_at();

-- events ----------------------------------------------------------------
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_updated_at on events;
create trigger set_updated_at before update on events
  for each row execute function set_updated_at();

-- indexes ----------------------------------------------------------------
create index if not exists leads_business_phone_status_idx on leads (business_id, phone, status);
create index if not exists calls_business_missed_at_idx on calls (business_id, missed_at);
create index if not exists appointments_business_starts_at_idx on appointments (business_id, starts_at);
create index if not exists events_business_created_at_idx on events (business_id, created_at);

-- Row-level security is intentionally OFF in Phase 1: only the server touches
-- this database, and only with the service-role key. Turn it on before any
-- client-facing dashboard reads these tables directly.
