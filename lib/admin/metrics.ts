import type { Business, Lead } from "@/lib/types";

// Pure functions, no Supabase calls — callers fetch rows, these just do the
// date/flag math on them. Keeps the attention-flag rules independently
// testable with fixture data (see scripts/test-admin-metrics.ts).

export function hoursSince(iso: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function daysSince(iso: string, now: Date = new Date()): number {
  return hoursSince(iso, now) / 24;
}

export function getWeekCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
}

// The Clients-list "needs attention" flag — broader/coarser than the
// Queue's specific stuck-conditions below, matching SPEC's "a row with
// zero conversations in seven days renders in amber whatever its status
// says."
export function isAttentionFlagged(input: {
  status: Business["status"];
  stripeConnectStatus: Business["stripe_connect_status"];
  leadsInLast7Days: number;
  hasEscalatedLead: boolean;
}): boolean {
  return (
    input.leadsInLast7Days === 0 ||
    input.hasEscalatedLead ||
    input.stripeConnectStatus === "pending" ||
    input.status === "paused"
  );
}

// Queue condition: Stripe Connect onboarding started but not finished
// within a reasonable window.
export function isConnectStuckPending(
  business: { stripe_connect_status: Business["stripe_connect_status"]; updated_at: string },
  now: Date = new Date(),
  thresholdDays = 3
): boolean {
  return business.stripe_connect_status === "pending" && daysSince(business.updated_at, now) > thresholdDays;
}

// Queue condition: a lead handed to the owner that hasn't moved since.
export function isLeadStuckEscalated(
  lead: { status: Lead["status"]; updated_at: string },
  now: Date = new Date(),
  thresholdHours = 48
): boolean {
  return lead.status === "escalated" && hoursSince(lead.updated_at, now) > thresholdHours;
}

export function daysLive(createdAt: string, now: Date = new Date()): number {
  return Math.floor(daysSince(createdAt, now));
}
