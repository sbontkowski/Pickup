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
  get STRIPE_WEBHOOK_SECRET() {
    return required("STRIPE_WEBHOOK_SECRET");
  },
  get GOOGLE_AGENT_CALLER_IDS() {
    return optional("GOOGLE_AGENT_CALLER_IDS");
  },
  get OWNER_FALLBACK_CELL() {
    return optional("OWNER_FALLBACK_CELL");
  },
};
