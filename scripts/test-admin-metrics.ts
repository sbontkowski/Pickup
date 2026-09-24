// Fixture-only checks for the pure attention-flag rules in
// lib/admin/metrics.ts — no DB/network calls, so this runs instantly and
// asserts each rule independently.
import { isAttentionFlagged, isConnectStuckPending, isLeadStuckEscalated, daysLive } from "@/lib/admin/metrics";

let failures = 0;
function check(label: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) failures++;
}

const now = new Date("2026-09-24T12:00:00Z");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
const daysAgo = (d: number) => hoursAgo(d * 24);

// isAttentionFlagged
check(
  "flags zero conversations in 7 days",
  isAttentionFlagged({ status: "active", stripeConnectStatus: "active", leadsInLast7Days: 0, hasEscalatedLead: false })
);
check(
  "flags an escalated lead",
  isAttentionFlagged({ status: "active", stripeConnectStatus: "active", leadsInLast7Days: 3, hasEscalatedLead: true })
);
check(
  "flags pending Connect status",
  isAttentionFlagged({ status: "active", stripeConnectStatus: "pending", leadsInLast7Days: 3, hasEscalatedLead: false })
);
check(
  "flags a paused business",
  isAttentionFlagged({ status: "paused", stripeConnectStatus: "active", leadsInLast7Days: 3, hasEscalatedLead: false })
);
check(
  "does not flag a healthy business",
  !isAttentionFlagged({ status: "active", stripeConnectStatus: "active", leadsInLast7Days: 3, hasEscalatedLead: false })
);

// isConnectStuckPending
check(
  "flags Connect pending for 4 days",
  isConnectStuckPending({ stripe_connect_status: "pending", updated_at: daysAgo(4) }, now)
);
check(
  "does not flag Connect pending for 1 day",
  !isConnectStuckPending({ stripe_connect_status: "pending", updated_at: daysAgo(1) }, now)
);
check(
  "does not flag Connect active regardless of age",
  !isConnectStuckPending({ stripe_connect_status: "active", updated_at: daysAgo(30) }, now)
);

// isLeadStuckEscalated
check(
  "flags a lead escalated 49 hours ago",
  isLeadStuckEscalated({ status: "escalated", updated_at: hoursAgo(49) }, now)
);
check(
  "does not flag a lead escalated 10 hours ago",
  !isLeadStuckEscalated({ status: "escalated", updated_at: hoursAgo(10) }, now)
);
check(
  "does not flag a booked lead regardless of age",
  !isLeadStuckEscalated({ status: "booked", updated_at: hoursAgo(200) }, now)
);

// daysLive
check("computes days live correctly", daysLive(daysAgo(10), now) === 10);

console.log(failures === 0 ? "\nPASS: admin metrics verified." : `\nFAIL: ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
