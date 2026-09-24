import { getSupabaseAdmin } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import {
  listSubscriptionsForCustomer,
  pickRelevantSubscription,
  classifySubscription,
  type SubscriptionBucket,
} from "@/lib/admin/stripe-subscriptions";
import type { Business } from "@/lib/types";

export const dynamic = "force-dynamic";

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function isThisMonth(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
}

export default async function AdminMoneyPage() {
  const supabase = getSupabaseAdmin();
  const { data: businesses } = await supabase.from("businesses").select("*").order("created_at", { ascending: true });
  const stripe = getStripeClient();
  const now = new Date();

  const rows = await Promise.all(
    ((businesses ?? []) as Business[]).map(async (business) => {
      if (!business.stripe_customer_id) {
        return { business, bucket: "none" as SubscriptionBucket, mrrCents: 0, canceledAt: null as string | null };
      }
      try {
        const subs = await listSubscriptionsForCustomer(stripe, business.stripe_customer_id);
        const classified = classifySubscription(pickRelevantSubscription(subs));
        return {
          business,
          bucket: classified.bucket,
          mrrCents: classified.mrrCents,
          canceledAt: classified.canceledAt,
        };
      } catch (err) {
        console.error(
          `Failed to fetch Stripe subscription for ${business.id}:`,
          err instanceof Error ? err.message : err
        );
        return { business, bucket: "none" as SubscriptionBucket, mrrCents: 0, canceledAt: null as string | null };
      }
    })
  );

  const totalMrrCents = rows.reduce((sum, r) => sum + r.mrrCents, 0);
  const activeCount = rows.filter((r) => r.bucket === "active").length;
  const trialingCount = rows.filter((r) => r.bucket === "trialing").length;
  const pastDueCount = rows.filter((r) => r.bucket === "past_due").length;
  const newThisMonth = rows.filter((r) => isThisMonth(r.business.created_at, now)).length;
  const churnedThisMonth = rows.filter((r) => isThisMonth(r.canceledAt, now)).length;

  return (
    <div>
      <h1>Money</h1>
      <p className="admin-muted">
        Live mirror of Stripe — nothing here is editable. Use the Stripe link on a row for anything that needs to
        change.
      </p>

      <div className="admin-stat-row">
        <div className="admin-stat">
          <div className="admin-stat-label">MRR</div>
          <div className="admin-stat-value">{formatCents(totalMrrCents)}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Active</div>
          <div className="admin-stat-value">{activeCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Trialing</div>
          <div className="admin-stat-value">{trialingCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Past due</div>
          <div className="admin-stat-value">{pastDueCount}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">New this month</div>
          <div className="admin-stat-value">{newThisMonth}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Churned this month</div>
          <div className="admin-stat-value">{churnedThisMonth}</div>
        </div>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Business</th>
            <th>Subscription</th>
            <th>MRR</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ business, bucket, mrrCents }) => (
            <tr key={business.id}>
              <td>{business.name}</td>
              <td>
                <span className={`admin-chip admin-chip-${bucket}`}>{bucket}</span>
              </td>
              <td>{formatCents(mrrCents)}</td>
              <td>
                {business.stripe_customer_id ? (
                  <a
                    href={`https://dashboard.stripe.com/customers/${business.stripe_customer_id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Stripe →
                  </a>
                ) : (
                  <span className="admin-muted">no Stripe customer</span>
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="admin-muted">
                No businesses yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
