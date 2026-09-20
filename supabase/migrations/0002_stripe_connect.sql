-- Adds Stripe Connect Express account tracking to businesses, so client
-- deposits route directly to the client's own bank account instead of the
-- platform's Stripe account. Idempotent — safe to re-run.

alter table businesses add column if not exists stripe_connect_account_id text;

alter table businesses add column if not exists stripe_connect_status text
  not null default 'not_started';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'businesses_stripe_connect_status_check'
  ) then
    alter table businesses add constraint businesses_stripe_connect_status_check
      check (stripe_connect_status in ('not_started', 'pending', 'active'));
  end if;
end $$;

create index if not exists businesses_stripe_connect_account_id_idx
  on businesses (stripe_connect_account_id);
