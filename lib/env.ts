// Environment loading. Every secret lives in .env.local, never in source.
// This is imported only from route handlers and scripts (never from a
// "use client" component) — SUPABASE_SERVICE_KEY etc. must never reach the
// browser bundle.
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Set it in .env.local (see .env.local.example).`
    );
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export const env = {
  get SUPABASE_URL() {
    return required("SUPABASE_URL");
  },
  get SUPABASE_SERVICE_KEY() {
    return required("SUPABASE_SERVICE_KEY");
  },
  get TWILIO_ACCOUNT_SID() {
    return required("TWILIO_ACCOUNT_SID");
  },
  get TWILIO_AUTH_TOKEN() {
    return required("TWILIO_AUTH_TOKEN");
  },
  get TWILIO_NUMBER() {
    return required("TWILIO_NUMBER");
  },
  get ANTHROPIC_API_KEY() {
    return required("ANTHROPIC_API_KEY");
  },
  get STRIPE_SECRET_KEY() {
    return required("STRIPE_SECRET_KEY");
  },
  // Stripe's newer webhook setup requires a separate destination per event
  // scope — "Your account" (checkout.session.completed) vs "Connected
  // accounts" (account.updated) — each with its own signing secret, even
  // when both point at this same URL. STRIPE_CONNECT_WEBHOOK_SECRET is
  // optional so a single-destination setup (old-style, one secret for
  // both scopes) still works.
  get STRIPE_WEBHOOK_SECRET() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  get STRIPE_CONNECT_WEBHOOK_SECRET() {
    return optional("STRIPE_CONNECT_WEBHOOK_SECRET");
  },
  get GOOGLE_AGENT_CALLER_IDS() {
    return optional("GOOGLE_AGENT_CALLER_IDS");
  },
  get APP_BASE_URL() {
    return optional("APP_BASE_URL") ?? "http://localhost:3000";
  },
  // Steven's own cell — the fallback the owner agent gives clients for
  // anything it can't do yet ("text Steven at {number}").
  get SUPPORT_CELL() {
    return required("SUPPORT_CELL");
  },
  // Vercel automatically sends this as `Authorization: Bearer <value>` on
  // requests it makes to scheduled Cron routes, once set in project env
  // vars — protects the weekly-report endpoint from public triggering.
  get CRON_SECRET() {
    return required("CRON_SECRET");
  },
};
