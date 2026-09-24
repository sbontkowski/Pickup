import { getSupabaseAdmin } from "@/lib/supabase";
import { getStripeClient } from "@/lib/stripe";
import { isConnectStuckPending, isLeadStuckEscalated, getWeekCutoff } from "@/lib/admin/metrics";
import {
  listSubscriptionsForCustomer,
  pickRelevantSubscription,
  classifySubscription,
} from "@/lib/admin/stripe-subscriptions";
import type { Business, Lead } from "@/lib/types";

export const dynamic = "force-dynamic";

interface QueueRow {
  type: string;
  businessName: string;
  detail: string;
  at: string;
  href: string;
}

export default async function AdminQueuePage() {
  const supabase = getSupabaseAdmin();
  const weekCutoffIso = getWeekCutoff().toISOString();

  const [{ data: businesses }, { data: escalatedLeads }, { data: failedMessages }, { data: leadsThisWeek }] =
    await Promise.all([
      supabase.from("businesses").select("*"),
      supabase.from("leads").select("*").eq("status", "escalated"),
      supabase
        .from("messages")
        .select("id, created_at, lead_id, leads(business_id, name, phone)")
        .is("twilio_sid", null)
        .eq("role", "agent")
        .gte("created_at", weekCutoffIso),
      supabase.from("leads").select("business_id, created_at").gte("created_at", weekCutoffIso),
    ]);

  const businessById = new Map((businesses ?? []).map((b: Business) => [b.id, b]));
  const rows: QueueRow[] = [];

  for (const business of (businesses ?? []) as Business[]) {
    if (isConnectStuckPending(business)) {
      rows.push({
        type: "Connect stuck",
        businessName: business.name,
        detail: "Stripe Connect onboarding started but hasn't finished in over 3 days.",
        at: business.updated_at,
        href: `/admin/c/${business.id}?tab=phone`,
      });
    }
  }

  for (const lead of (escalatedLeads ?? []) as Lead[]) {
    if (isLeadStuckEscalated(lead)) {
      const business = businessById.get(lead.business_id);
      rows.push({
        type: "Escalated, no follow-up",
        businessName: business?.name ?? "Unknown",
        detail: `${lead.name || lead.phone} has been waiting on the owner for over 48 hours.`,
        at: lead.updated_at,
        href: `/admin/c/${lead.business_id}?tab=conversations&lead=${lead.id}`,
      });
    }
  }

  for (const msg of failedMessages ?? []) {
    const lead = msg.leads as unknown as { business_id: string; name: string | null; phone: string | null } | null;
    if (!lead) continue;
    const business = businessById.get(lead.business_id);
    rows.push({
      type: "Failed text delivery",
      businessName: business?.name ?? "Unknown",
      detail: `A reply to ${lead.name || lead.phone || "a customer"} failed to send.`,
      at: msg.created_at,
      href: `/admin/c/${lead.business_id}?tab=conversations&lead=${msg.lead_id}`,
    });
  }

  const leadsCountByBusiness = new Map<string, number>();
  for (const lead of leadsThisWeek ?? []) {
    leadsCountByBusiness.set(lead.business_id, (leadsCountByBusiness.get(lead.business_id) ?? 0) + 1);
  }
  for (const business of (businesses ?? []) as Business[]) {
    if (business.status === "active" && (leadsCountByBusiness.get(business.id) ?? 0) === 0) {
      rows.push({
        type: "No conversations in 7 days",
        businessName: business.name,
        detail: "No inbound leads this week — worth a check-in call.",
        at: business.updated_at,
        href: `/admin/c/${business.id}?tab=conversations`,
      });
    }
  }

  const stripe = getStripeClient();
  const businessesWithStripe = ((businesses ?? []) as Business[]).filter((b) => b.stripe_customer_id);
  const pastDueChecks = await Promise.all(
    businessesWithStripe.map(async (business) => {
      try {
        const subs = await listSubscriptionsForCustomer(stripe, business.stripe_customer_id!);
        return { business, classified: classifySubscription(pickRelevantSubscription(subs)) };
      } catch (err) {
        console.error(
          `Failed to fetch Stripe subscription for ${business.id}:`,
          err instanceof Error ? err.message : err
        );
        return null;
      }
    })
  );
  for (const result of pastDueChecks) {
    if (result && result.classified.bucket === "past_due") {
      rows.push({
        type: "Payment past due",
        businessName: result.business.name,
        detail: "Their subscription payment failed.",
        at: result.business.updated_at,
        href: `https://dashboard.stripe.com/customers/${result.business.stripe_customer_id}`,
      });
    }
  }

  rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  return (
    <div>
      <h1>Attention queue</h1>
      {rows.length === 0 ? (
        <p className="admin-muted">Nothing needs attention right now.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Business</th>
              <th>Detail</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                <td>
                  <span className="admin-chip admin-chip-amber">{row.type}</span>
                </td>
                <td>{row.businessName}</td>
                <td>{row.detail}</td>
                <td>
                  <a href={row.href}>View</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
