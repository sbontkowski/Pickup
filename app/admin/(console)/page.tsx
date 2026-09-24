import Link from "next/link";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getWeekCutoff, isAttentionFlagged, daysLive } from "@/lib/admin/metrics";
import { CATCH_PLAN_CENTS, ANSWER_PLAN_CENTS } from "@/lib/pricing";
import type { Business } from "@/lib/types";

export const dynamic = "force-dynamic";

function mrrCentsFor(business: Business): number {
  if (business.status !== "active") return 0;
  return business.plan === "answer" ? ANSWER_PLAN_CENTS : CATCH_PLAN_CENTS;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

export default async function AdminClientsPage() {
  const supabase = getSupabaseAdmin();
  const weekCutoffIso = getWeekCutoff().toISOString();

  const [{ data: businesses }, { data: leadsThisWeek }, { data: escalatedLeads }, { data: appointmentsThisWeek }] =
    await Promise.all([
      supabase.from("businesses").select("*").order("created_at", { ascending: true }),
      supabase.from("leads").select("business_id, created_at").gte("created_at", weekCutoffIso),
      supabase.from("leads").select("business_id").eq("status", "escalated"),
      supabase.from("appointments").select("business_id, created_at").gte("created_at", weekCutoffIso),
    ]);

  const leadsCountByBusiness = new Map<string, number>();
  for (const lead of leadsThisWeek ?? []) {
    leadsCountByBusiness.set(lead.business_id, (leadsCountByBusiness.get(lead.business_id) ?? 0) + 1);
  }

  const escalatedBusinessIds = new Set((escalatedLeads ?? []).map((l) => l.business_id));

  const appointmentsCountByBusiness = new Map<string, number>();
  for (const appt of appointmentsThisWeek ?? []) {
    appointmentsCountByBusiness.set(appt.business_id, (appointmentsCountByBusiness.get(appt.business_id) ?? 0) + 1);
  }

  const rows = (businesses ?? []).map((business: Business) => {
    const conversationsThisWeek = leadsCountByBusiness.get(business.id) ?? 0;
    const bookingsThisWeek = appointmentsCountByBusiness.get(business.id) ?? 0;
    const attention = isAttentionFlagged({
      status: business.status,
      stripeConnectStatus: business.stripe_connect_status,
      leadsInLast7Days: conversationsThisWeek,
      hasEscalatedLead: escalatedBusinessIds.has(business.id),
    });
    return { business, conversationsThisWeek, bookingsThisWeek, attention, mrrCents: mrrCentsFor(business) };
  });

  rows.sort((a, b) => {
    if (a.attention !== b.attention) return a.attention ? -1 : 1;
    return a.business.name.localeCompare(b.business.name);
  });

  const totalMrrCents = rows.reduce((sum, r) => sum + r.mrrCents, 0);

  return (
    <div>
      <h1>Clients</h1>
      <div className="admin-stat-row">
        <div className="admin-stat">
          <div className="admin-stat-label">Clients</div>
          <div className="admin-stat-value">{rows.length}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">Needs attention</div>
          <div className="admin-stat-value">{rows.filter((r) => r.attention).length}</div>
        </div>
        <div className="admin-stat">
          <div className="admin-stat-label">MRR</div>
          <div className="admin-stat-value">{formatCents(totalMrrCents)}</div>
        </div>
      </div>

      <table className="admin-table">
        <thead>
          <tr>
            <th>Business</th>
            <th>Status</th>
            <th>Days live</th>
            <th>Conversations (7d)</th>
            <th>Bookings (7d)</th>
            <th>MRR</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ business, conversationsThisWeek, bookingsThisWeek, attention, mrrCents }) => (
            <tr key={business.id} className={attention ? "admin-row-attention" : undefined}>
              <td>
                <Link href={`/admin/c/${business.id}`}>{business.name}</Link>
              </td>
              <td>
                <span className={`admin-chip admin-chip-${business.status}`}>{business.status}</span>
              </td>
              <td>{daysLive(business.created_at)}</td>
              <td>{conversationsThisWeek}</td>
              <td>{bookingsThisWeek}</td>
              <td>{formatCents(mrrCents)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} className="admin-muted">
                No businesses yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
