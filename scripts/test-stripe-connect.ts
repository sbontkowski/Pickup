// Phase 4 proof (Stripe Connect): creates a real Stripe Express connected
// account for the seed business, waits for you to complete test-mode
// onboarding in a browser, then proves both the webhook handler and the
// deposit-routing logic work — without needing the Stripe CLI or any
// tunnel into this dev server.
//
// Usage:
//   1. In one terminal: npm run dev
//   2. In another:      npm run test:stripe-connect
//   3. When it prints a URL, open it and click "fill test data" through
//      the onboarding form (test mode only takes real data at your bank).
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { env } from "@/lib/env";
import { executeAgentTool } from "@/lib/agent-tools";
import type { Business, Lead } from "@/lib/types";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const webhookUrl = `${BASE_URL}/api/stripe/webhook`;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
  console.error("Need STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET set in .env.local.");
  process.exit(1);
}

async function ensureOnboardingLink(supabase: ReturnType<typeof getSupabaseAdmin>, business: Business): Promise<string> {
  const stripe = getStripeClient();

  let accountId = business.stripe_connect_account_id;
  if (!accountId) {
    const account = await stripe.accounts.create({
      country: "US",
      controller: {
        stripe_dashboard: { type: "express" },
        fees: { payer: "application" },
        losses: { payments: "application" },
        requirement_collection: "stripe",
      },
      capabilities: {
        card_payments: { requested: true },
        transfers: { requested: true },
      },
    });
    accountId = account.id;
    await supabase.from("businesses").update({ stripe_connect_account_id: accountId, stripe_connect_status: "pending" }).eq("id", business.id);
    console.log(`Created Stripe Express account ${accountId}`);
  } else {
    console.log(`Reusing existing Stripe Express account ${accountId}`);
  }

  const accountLink = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${env.APP_BASE_URL}/api/connect/refresh?business_id=${business.id}`,
    return_url: `${env.APP_BASE_URL}/connect/return?business_id=${business.id}`,
  });

  return accountLink.url;
}

async function waitForOnboarding(accountId: string, timeoutMs = 5 * 60 * 1000): Promise<Stripe.Account> {
  const stripe = getStripeClient();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const account = await stripe.accounts.retrieve(accountId);
    if (account.charges_enabled && account.payouts_enabled && account.details_submitted) {
      return account;
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error("Timed out waiting for onboarding to complete. Run the script again after finishing the form.");
}

async function postSignedAccountUpdated(account: Stripe.Account) {
  const eventBody = {
    id: `evt_test_${Math.random().toString(16).slice(2)}`,
    type: "account.updated",
    data: { object: account },
  };
  const payload = JSON.stringify(eventBody);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret! });
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
  if (!res.ok) throw new Error(`Webhook POST failed: ${res.status} ${await res.text()}`);
}

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase.from("businesses").select("*").order("created_at", { ascending: true }).limit(1).single();
  if (!business) throw new Error("No seed business. Run npm run db:seed first.");

  if (business.stripe_connect_status !== "active") {
    const url = await ensureOnboardingLink(supabase, business as Business);
    console.log(`\nOpen this URL and click through test-mode onboarding (use "fill test data" where offered):\n${url}\n`);
    console.log("Waiting for onboarding to complete...");

    const { data: refreshed } = await supabase.from("businesses").select("*").eq("id", business.id).single();
    const account = await waitForOnboarding(refreshed!.stripe_connect_account_id);
    console.log("\nOnboarding complete on Stripe's side. Simulating the account.updated webhook...");

    await postSignedAccountUpdated(account);
    await new Promise((r) => setTimeout(r, 1500));

    const { data: activated } = await supabase.from("businesses").select("stripe_connect_status").eq("id", business.id).single();
    console.log(`stripe_connect_status is now: ${activated!.stripe_connect_status}`);
    if (activated!.stripe_connect_status !== "active") {
      throw new Error("Webhook did not flip stripe_connect_status to active.");
    }
    console.log("PASS: Connect onboarding detected and activated.\n");
  } else {
    console.log("Seed business is already Connect-active — skipping onboarding.\n");
  }

  console.log("--- Verifying a deposit routes to the connected account ---");
  const { data: activeBusiness } = await supabase.from("businesses").select("*").eq("id", business.id).single();

  const phone = "+15555550400";
  await supabase.from("leads").delete().eq("phone", phone);
  const { data: lead } = await supabase
    .from("leads")
    .insert({ business_id: business.id, phone, name: "Connect Test", address: "1 Test Way", zip: "28277", job_type: "repair", urgency: "soon", status: "booked" })
    .select("*")
    .single();

  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { data: appointment } = await supabase
    .from("appointments")
    .insert({ lead_id: lead!.id, business_id: business.id, starts_at: startsAt.toISOString(), ends_at: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString(), status: "held", deposit_status: "none" })
    .select("*")
    .single();

  const result = await executeAgentTool(
    "send_payment_link",
    { appointment_id: appointment!.id },
    { business: activeBusiness as Business, lead: lead as Lead, lastCustomerMessage: "", isAiAgent: false }
  );
  if (result.isError) throw new Error(`send_payment_link failed: ${result.content}`);

  const { payment_url } = JSON.parse(result.content);
  console.log(`Created checkout session: ${payment_url}`);

  const { data: payment } = await supabase.from("payments").select("stripe_session_id").eq("appointment_id", appointment!.id).single();
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.retrieve(payment!.stripe_session_id, { expand: ["payment_intent"] });
  const paymentIntent = session.payment_intent as Stripe.PaymentIntent;
  const destination = paymentIntent.transfer_data?.destination;

  console.log(`PaymentIntent transfer_data.destination: ${destination}`);
  console.log(`Business's connected account:            ${activeBusiness!.stripe_connect_account_id}`);

  if (destination !== activeBusiness!.stripe_connect_account_id) {
    throw new Error("Deposit is not routed to the business's connected account.");
  }

  console.log("\nPASS: deposit is routed directly to the business's own Stripe account.");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
