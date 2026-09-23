// Phase 4 proof: exercises both Stripe flows against a locally running
// `npm run dev`.
//
// 1. Deposit flow: creates a real test-mode Stripe Checkout session via the
//    same send_payment_link tool the agent calls, then simulates Stripe
//    delivering the checkout.session.completed webhook for it (signed with
//    the real webhook secret) and checks the appointment gets confirmed.
// 2. Subscription flow: simulates a subscription checkout.session.completed
//    event and checks a new businesses row gets created.
// 3. Confirms a forged webhook signature is rejected with 400.
//
// Usage:
//   1. In one terminal: npm run dev
//   2. In another:      npm run test:stripe
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { executeAgentTool, type ToolContext } from "@/lib/agent-tools";
import type { Business, Lead } from "@/lib/types";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const webhookUrl = `${BASE_URL}/api/stripe/webhook`;
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

if (!webhookSecret || !process.env.STRIPE_SECRET_KEY) {
  console.error("Need STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET set in .env.local.");
  process.exit(1);
}

async function postSignedEvent(eventBody: object) {
  const payload = JSON.stringify(eventBody);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret! });
  return fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": header },
    body: payload,
  });
}

async function testDepositFlow() {
  console.log("--- Deposit flow ---");
  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase.from("businesses").select("*").order("created_at", { ascending: true }).limit(1).single();
  if (!business) throw new Error("No seed business. Run npm run db:seed first.");
  if (business.deposit_cents <= 0) throw new Error("Seed business has no deposit configured.");

  const phone = "+15555550300";
  await supabase.from("leads").delete().eq("phone", phone);
  const { data: lead } = await supabase
    .from("leads")
    .insert({
      business_id: business.id,
      phone,
      name: "Test Customer",
      address: "123 Test St",
      zip: business.facts?.service_area_zips?.[0] ?? "28277",
      job_type: "repair",
      urgency: "soon",
      status: "booked",
    })
    .select("*")
    .single();

  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const { data: appointment } = await supabase
    .from("appointments")
    .insert({
      lead_id: lead!.id,
      business_id: business.id,
      starts_at: startsAt.toISOString(),
      ends_at: new Date(startsAt.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      status: "held",
      deposit_status: "none",
    })
    .select("*")
    .single();

  const ctx: ToolContext = { business: business as Business, lead: lead as Lead, lastCustomerMessage: "", isAiAgent: false };
  const result = await executeAgentTool("send_payment_link", { appointment_id: appointment!.id }, ctx);
  if (result.isError) throw new Error(`send_payment_link failed: ${result.content}`);
  const { payment_url } = JSON.parse(result.content);
  console.log(`Created real Stripe test-mode checkout session: ${payment_url}`);

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("appointment_id", appointment!.id)
    .single();
  console.log(`payments row: status=${payment!.status}, session=${payment!.stripe_session_id}`);

  console.log("Simulating Stripe delivering checkout.session.completed...");
  const res = await postSignedEvent({
    id: `evt_test_${Math.random().toString(16).slice(2)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: payment!.stripe_session_id,
        mode: "payment",
        amount_total: business.deposit_cents,
        metadata: { appointment_id: appointment!.id },
      },
    },
  });
  if (!res.ok) throw new Error(`Webhook POST failed: ${res.status} ${await res.text()}`);

  await new Promise((r) => setTimeout(r, 1500));

  const { data: confirmedAppt } = await supabase.from("appointments").select("*").eq("id", appointment!.id).single();
  const { data: paidPayment } = await supabase.from("payments").select("*").eq("appointment_id", appointment!.id).single();

  console.log(`appointment: status=${confirmedAppt.status}, deposit_status=${confirmedAppt.deposit_status}`);
  console.log(`payment: status=${paidPayment.status}, paid_at=${paidPayment.paid_at}`);

  if (confirmedAppt.status !== "confirmed" || confirmedAppt.deposit_status !== "paid" || paidPayment.status !== "paid") {
    throw new Error("Deposit flow did not confirm the appointment as expected.");
  }

  console.log("PASS: deposit webhook confirmed the appointment.\n");
}

async function testSubscriptionFlow() {
  console.log("--- Subscription flow ---");
  const supabase = getSupabaseAdmin();
  const customerId = `cus_test_${Math.random().toString(16).slice(2)}`;
  const phone = "+15555550301";

  await supabase.from("businesses").delete().eq("stripe_customer_id", customerId);

  const res = await postSignedEvent({
    id: `evt_test_${Math.random().toString(16).slice(2)}`,
    type: "checkout.session.completed",
    data: {
      object: {
        id: `cs_test_${Math.random().toString(16).slice(2)}`,
        mode: "subscription",
        customer: customerId,
        amount_total: 19900,
        customer_details: { phone, email: "test@example.com" },
      },
    },
  });
  if (!res.ok) throw new Error(`Webhook POST failed: ${res.status} ${await res.text()}`);

  await new Promise((r) => setTimeout(r, 1500));

  const { data: business } = await supabase.from("businesses").select("*").eq("stripe_customer_id", customerId).maybeSingle();
  if (!business) throw new Error("No business row was created from the subscription webhook.");

  console.log(`Created business ${business.id}: plan=${business.plan}, status=${business.status}, owner_cell=${business.owner_cell}`);
  if (business.plan !== "catch" || business.status !== "trial") {
    throw new Error("Business was created with unexpected plan/status.");
  }

  console.log("Re-sending the same event to check idempotency...");
  await postSignedEvent({
    id: `evt_test_${Math.random().toString(16).slice(2)}`,
    type: "checkout.session.completed",
    data: { object: { id: `cs_test_dup`, mode: "subscription", customer: customerId, amount_total: 19900, customer_details: { phone } } },
  });
  await new Promise((r) => setTimeout(r, 1000));
  const { data: businesses } = await supabase.from("businesses").select("id").eq("stripe_customer_id", customerId);
  if ((businesses?.length ?? 0) !== 1) {
    throw new Error(`Expected exactly 1 business for this customer, found ${businesses?.length}.`);
  }

  console.log("PASS: subscription webhook created exactly one business.\n");
}

async function testForgedSignature() {
  console.log("--- Forged signature ---");
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=bogus" },
    body: JSON.stringify({ type: "checkout.session.completed" }),
  });
  console.log(`HTTP ${res.status}`);
  if (res.status !== 400) throw new Error("Expected 400 for a forged signature.");
  console.log("PASS: forged signature rejected.\n");
}

async function main() {
  await testForgedSignature();
  await testSubscriptionFlow();
  await testDepositFlow();
  console.log("All Stripe webhook tests passed.");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
