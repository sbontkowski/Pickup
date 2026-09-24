import type Stripe from "stripe";
import { getStripeClient } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTwilioClient } from "@/lib/twilio";
import { env } from "@/lib/env";
import { ANSWER_PLAN_CENTS } from "@/lib/pricing";

async function sendSms(to: string, body: string) {
  try {
    const client = getTwilioClient();
    await client.messages.create({ from: env.TWILIO_NUMBER, to, body });
  } catch (err) {
    console.error("Failed to send SMS from Stripe webhook:", err instanceof Error ? err.message : err);
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const stripe = getStripeClient();
  // Two possible signing secrets: the main destination (checkout.session.completed,
  // "Your account" scope) and the Connect destination (account.updated,
  // "Connected accounts" scope) each sign with their own secret, even
  // though both point at this same URL.
  const secrets = [env.STRIPE_WEBHOOK_SECRET, env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(
    (s): s is string => Boolean(s)
  );

  let event: Stripe.Event | null = null;
  for (const secret of secrets) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, secret);
      break;
    } catch {
      // Try the next secret.
    }
  }

  if (!event) {
    console.error("Stripe signature verification failed against all configured secrets.");
    return new Response("Invalid signature", { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (session.mode === "payment") {
      await handleDepositPaid(session);
    } else if (session.mode === "subscription") {
      await handleSubscriptionCreated(session);
    }
  } else if (event.type === "account.updated") {
    await handleAccountUpdated(event.data.object as Stripe.Account);
  }

  return Response.json({ received: true });
}

async function handleDepositPaid(session: Stripe.Checkout.Session) {
  const appointmentId = session.metadata?.appointment_id;
  if (!appointmentId) {
    console.error(`checkout.session.completed (payment mode) with no appointment_id metadata: ${session.id}`);
    return;
  }

  const supabase = getSupabaseAdmin();

  const { data: payment } = await supabase
    .from("payments")
    .select("id, status")
    .eq("stripe_session_id", session.id)
    .maybeSingle();

  if (payment?.status === "paid") {
    return; // Already processed — Stripe retried this event.
  }

  if (payment) {
    await supabase.from("payments").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payment.id);
  } else {
    // No payments row from send_payment_link (shouldn't normally happen) — record it anyway.
    await supabase.from("payments").insert({
      appointment_id: appointmentId,
      stripe_session_id: session.id,
      amount_cents: session.amount_total ?? 0,
      status: "paid",
      paid_at: new Date().toISOString(),
    });
  }

  const { data: appointment } = await supabase
    .from("appointments")
    .update({ deposit_status: "paid", status: "confirmed" })
    .eq("id", appointmentId)
    .select("*, leads(*)")
    .single();

  if (!appointment) {
    console.error(`Could not find appointment ${appointmentId} to confirm.`);
    return;
  }

  const lead = appointment.leads as { id: string; business_id: string; phone: string; name: string | null };
  const { data: business } = await supabase.from("businesses").select("*").eq("id", lead.business_id).single();
  if (!business) return;

  const dateLabel = new Date(appointment.starts_at).toLocaleString("en-US", {
    timeZone: business.timezone,
    weekday: "short",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  await sendSms(lead.phone, `Payment received! You're confirmed for ${dateLabel}. See you then.`);
  await sendSms(business.owner_cell, `Deposit paid — ${lead.name ?? lead.phone} for ${dateLabel}`);

  await supabase.from("events").insert({
    business_id: business.id,
    lead_id: lead.id,
    type: "deposit_paid",
    data: { appointment_id: appointmentId, amount_cents: session.amount_total },
  });
}

async function handleSubscriptionCreated(session: Stripe.Checkout.Session) {
  const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
  if (!customerId) {
    console.error(`checkout.session.completed (subscription mode) with no customer id: ${session.id}`);
    return;
  }

  const supabase = getSupabaseAdmin();

  const { data: existing } = await supabase
    .from("businesses")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  if (existing) {
    return; // Already onboarded — Stripe retried this event.
  }

  const phone = session.customer_details?.phone || null;
  const plan = session.amount_total === ANSWER_PLAN_CENTS ? "answer" : "catch";

  const { data: business, error } = await supabase
    .from("businesses")
    .insert({
      name: "New Client",
      owner_cell: phone,
      stripe_customer_id: customerId,
      plan,
      status: "trial",
      facts: {},
    })
    .select("id")
    .single();

  if (error || !business) {
    console.error("Failed to create business from subscription checkout:", error?.message);
    return;
  }

  if (!phone) {
    console.error(
      `Business ${business.id} created with no phone number from Stripe (enable phone number collection on the Payment Link). Follow up manually.`
    );
    return;
  }

  const stripe = getStripeClient();
  let onboardingUrl: string | null = null;
  try {
    const account = await stripe.accounts.create({
      country: "US",
      email: session.customer_details?.email ?? undefined,
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

    await supabase
      .from("businesses")
      .update({ stripe_connect_account_id: account.id, stripe_connect_status: "pending" })
      .eq("id", business.id);

    const accountLink = await stripe.accountLinks.create({
      account: account.id,
      type: "account_onboarding",
      refresh_url: `${env.APP_BASE_URL}/api/connect/refresh?business_id=${business.id}`,
      return_url: `${env.APP_BASE_URL}/connect/return?business_id=${business.id}`,
    });
    onboardingUrl = accountLink.url;
  } catch (err) {
    console.error("Failed to create Stripe Connect account:", err instanceof Error ? err.message : err);
  }

  await sendSms(
    phone,
    onboardingUrl
      ? `Welcome to Pickup! First, set up how you get paid: ${onboardingUrl} Then reply here and we'll get your business set up.`
      : "Welcome to Pickup! We'll text you a few quick questions to get your business set up so we can start booking your missed calls. Reply anytime to get started."
  );
}

async function handleAccountUpdated(account: Stripe.Account) {
  if (!account.details_submitted || !account.charges_enabled || !account.payouts_enabled) {
    return; // Not fully onboarded yet.
  }

  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, stripe_connect_status, owner_cell")
    .eq("stripe_connect_account_id", account.id)
    .maybeSingle();

  if (!business || business.stripe_connect_status === "active") {
    return; // Not ours, or already flipped (account.updated fires repeatedly).
  }

  await supabase.from("businesses").update({ stripe_connect_status: "active" }).eq("id", business.id);

  if (business.owner_cell) {
    await sendSms(business.owner_cell, "You're all set to start collecting deposits — they'll go straight to your bank account.");
  }
}
