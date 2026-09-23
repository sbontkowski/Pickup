import { getStripeClient } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase";
import { env } from "@/lib/env";

// Account Links expire after a few minutes and are single-use. Stripe
// redirects here when a client's onboarding link has gone stale; mint a
// fresh one for the same account and send them straight back in, so an
// old SMS link never dead-ends.
export async function GET(request: Request) {
  const businessId = new URL(request.url).searchParams.get("business_id");
  if (!businessId) {
    return new Response("Missing business_id", { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase
    .from("businesses")
    .select("id, stripe_connect_account_id")
    .eq("id", businessId)
    .maybeSingle();

  if (!business?.stripe_connect_account_id) {
    return new Response("No Stripe Connect account for this business", { status: 404 });
  }

  const stripe = getStripeClient();
  const accountLink = await stripe.accountLinks.create({
    account: business.stripe_connect_account_id,
    type: "account_onboarding",
    refresh_url: `${env.APP_BASE_URL}/api/connect/refresh?business_id=${business.id}`,
    return_url: `${env.APP_BASE_URL}/connect/return?business_id=${business.id}`,
  });

  return Response.redirect(accountLink.url, 302);
}
