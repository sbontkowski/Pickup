import type Stripe from "stripe";

export type SubscriptionBucket = "active" | "trialing" | "past_due" | "canceled" | "none";

export interface ClassifiedSubscription {
  bucket: SubscriptionBucket;
  mrrCents: number;
  canceledAt: string | null;
  subscriptionId: string | null;
}

export async function listSubscriptionsForCustomer(stripe: Stripe, customerId: string): Promise<Stripe.Subscription[]> {
  const result = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
  return result.data;
}

// A customer can (rarely) have more than one subscription on record — pick
// the one that matters: any live one over a canceled one, most recent among
// ties.
const STATUS_PRIORITY: Record<string, number> = {
  active: 0,
  trialing: 1,
  past_due: 2,
  unpaid: 2,
  canceled: 3,
  incomplete: 4,
  incomplete_expired: 5,
  paused: 5,
};

export function pickRelevantSubscription(subs: Stripe.Subscription[]): Stripe.Subscription | null {
  if (subs.length === 0) return null;
  const sorted = [...subs].sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 9;
    const pb = STATUS_PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    return b.created - a.created;
  });
  return sorted[0];
}

export function classifySubscription(sub: Stripe.Subscription | null): ClassifiedSubscription {
  if (!sub) {
    return { bucket: "none", mrrCents: 0, canceledAt: null, subscriptionId: null };
  }

  let bucket: SubscriptionBucket;
  switch (sub.status) {
    case "active":
      bucket = "active";
      break;
    case "trialing":
      bucket = "trialing";
      break;
    case "past_due":
    case "unpaid":
      bucket = "past_due";
      break;
    case "canceled":
      bucket = "canceled";
      break;
    default:
      bucket = "none";
  }

  // Only a currently-paying subscription counts toward MRR — trialing
  // hasn't billed yet, past_due/canceled aren't reliably collecting.
  const unitAmount = sub.items.data[0]?.price?.unit_amount ?? 0;
  const mrrCents = bucket === "active" ? unitAmount : 0;

  return {
    bucket,
    mrrCents,
    canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    subscriptionId: sub.id,
  };
}
