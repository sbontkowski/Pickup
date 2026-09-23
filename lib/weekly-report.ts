import { DateTime } from "luxon";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTwilioClient } from "@/lib/twilio";
import { env } from "@/lib/env";
import type { Business } from "@/lib/types";

export interface WeeklyReportResult {
  businessId: string;
  sent: boolean;
  reason?: string;
  message?: string;
}

function computeTopFixLine(calls: { missed_at: string }[], timezone: string): string | null {
  const buckets = new Map<string, { count: number; label: string }>();

  for (const call of calls) {
    const dt = DateTime.fromISO(call.missed_at, { zone: "utc" }).setZone(timezone);
    const blockStart = Math.floor(dt.hour / 2) * 2;
    const blockStartDt = dt.set({ hour: blockStart, minute: 0 });
    const blockEndDt = blockStartDt.plus({ hours: 2 });
    const key = `${dt.toFormat("ccc")}-${blockStart}`;
    const label = `${dt.toFormat("ccc")} ${blockStartDt.toFormat("h")}–${blockEndDt.toFormat("h a")}`;
    const existing = buckets.get(key);
    buckets.set(key, { count: (existing?.count ?? 0) + 1, label });
  }

  let top: { count: number; label: string } | null = null;
  for (const bucket of buckets.values()) {
    if (!top || bucket.count > top.count) top = bucket;
  }

  if (!top || top.count < 3) return null;
  return `Top fix this week: you missed ${top.count} calls ${top.label} — want a second ring group? Reply YES.`;
}

export async function sendWeeklyReport(business: Business, force = false): Promise<WeeklyReportResult> {
  const now = DateTime.now().setZone(business.timezone);

  if (!force && now.weekday !== 1) {
    return { businessId: business.id, sent: false, reason: "not Monday in this business's timezone" };
  }

  if (!business.owner_cell) {
    return { businessId: business.id, sent: false, reason: "no owner_cell" };
  }

  const weekStart = now.startOf("week").minus({ weeks: 1 }); // last Monday 00:00 local
  const weekEnd = weekStart.plus({ days: 7 });
  const weekStartIso = weekStart.toUTC().toISO()!;
  const weekEndIso = weekEnd.toUTC().toISO()!;
  const weekKey = weekStart.toISODate()!;

  const supabase = getSupabaseAdmin();

  if (!force) {
    const { data: existing } = await supabase
      .from("events")
      .select("id")
      .eq("business_id", business.id)
      .eq("type", "weekly_report")
      .contains("data", { week_start: weekKey })
      .maybeSingle();
    if (existing) {
      return { businessId: business.id, sent: false, reason: `already sent for week of ${weekKey}` };
    }
  }

  const { data: calls } = await supabase
    .from("calls")
    .select("caller_phone, missed_at, texted_at, caller_type")
    .eq("business_id", business.id)
    .gte("missed_at", weekStartIso)
    .lt("missed_at", weekEndIso);

  const { data: leads } = await supabase
    .from("leads")
    .select("id, status")
    .eq("business_id", business.id)
    .gte("created_at", weekStartIso)
    .lt("created_at", weekEndIso);

  const { data: appointments } = await supabase
    .from("appointments")
    .select("id")
    .eq("business_id", business.id)
    .gte("created_at", weekStartIso)
    .lt("created_at", weekEndIso);

  const { data: allAppointmentIds } = await supabase.from("appointments").select("id").eq("business_id", business.id);
  const apptIds = (allAppointmentIds ?? []).map((a) => a.id);

  const { data: payments } =
    apptIds.length > 0
      ? await supabase
          .from("payments")
          .select("amount_cents")
          .in("appointment_id", apptIds)
          .eq("status", "paid")
          .gte("paid_at", weekStartIso)
          .lt("paid_at", weekEndIso)
      : { data: [] as { amount_cents: number }[] };

  const callsMissed = calls?.length ?? 0;
  const textedCount = calls?.filter((c) => c.texted_at).length ?? 0;
  const leadsCount = leads?.length ?? 0;
  const bookedCount = appointments?.length ?? 0;
  const depositsCents = (payments ?? []).reduce((sum, p) => sum + p.amount_cents, 0);
  const aiAgentCalls = calls?.filter((c) => c.caller_type === "ai_agent").length ?? 0;

  const facts = business.facts as Record<string, unknown>;
  const avgTicketCents = typeof facts.avg_ticket_cents === "number" ? facts.avg_ticket_cents : 0;
  const estRevenueCents = bookedCount * avgTicketCents;

  const topFixLine = computeTopFixLine(calls ?? [], business.timezone);

  const lines = [
    `${business.name.toUpperCase()} • Week of ${weekStart.toFormat("MMM d")}`,
    `Calls missed: ${callsMissed} → texted: ${textedCount}`,
    `Leads: ${leadsCount} • Booked: ${bookedCount} • Deposits: $${(depositsCents / 100).toFixed(0)}`,
    `Est. revenue recovered: $${(estRevenueCents / 100).toFixed(0)}${
      bookedCount > 0 ? ` (${bookedCount} jobs × your avg $${(avgTicketCents / 100).toFixed(0)})` : ""
    }`,
  ];
  if (aiAgentCalls > 0) lines.push(`${aiAgentCalls} AI agent call${aiAgentCalls === 1 ? "" : "s"} answered`);
  if (topFixLine) lines.push(topFixLine);

  const message = lines.join("\n");

  try {
    const client = getTwilioClient();
    await client.messages.create({ from: env.TWILIO_NUMBER, to: business.owner_cell, body: message });
  } catch (err) {
    console.error(`Failed to send weekly report to business ${business.id}:`, err instanceof Error ? err.message : err);
    return { businessId: business.id, sent: false, reason: "SMS send failed", message };
  }

  await supabase.from("events").insert({
    business_id: business.id,
    type: "weekly_report",
    data: {
      week_start: weekKey,
      calls_missed: callsMissed,
      texted: textedCount,
      leads: leadsCount,
      booked: bookedCount,
      deposits_cents: depositsCents,
      est_revenue_cents: estRevenueCents,
      ai_agent_calls: aiAgentCalls,
    },
  });

  return { businessId: business.id, sent: true, message };
}
