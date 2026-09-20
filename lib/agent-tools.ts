import type Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getOpenWindows } from "@/lib/availability";
import { computeLeadScore, computeEstValueCents, type Urgency } from "@/lib/lead-score";
import { sendBookingLiveLine, sendEscalationAlert } from "@/lib/owner-alerts";
import type { Business, Lead } from "@/lib/types";

export interface ToolContext {
  business: Business;
  lead: Lead;
  lastCustomerMessage: string;
  isAiAgent: boolean;
}

export interface ToolResult {
  content: string;
  isError?: boolean;
}

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_availability",
    description:
      "Returns the next open appointment windows for this business, in the business's own timezone.",
    input_schema: {
      type: "object",
      properties: {
        urgency: { type: "string", enum: ["emergency", "soon", "flexible"] },
      },
      required: ["urgency"],
    },
  },
  {
    name: "book_slot",
    description:
      "Books the customer into a specific open window (use the exact starts_at value from get_availability).",
    input_schema: {
      type: "object",
      properties: {
        starts_at: { type: "string", description: "Exact ISO 8601 starts_at from get_availability" },
        name: { type: "string" },
        address: { type: "string" },
        zip: { type: "string" },
        job_type: { type: "string" },
      },
      required: ["starts_at", "name", "address", "zip", "job_type"],
    },
  },
  {
    name: "send_payment_link",
    description: "Creates a payment link for the business's deposit/diagnostic fee for a booked appointment.",
    input_schema: {
      type: "object",
      properties: {
        appointment_id: { type: "string" },
      },
      required: ["appointment_id"],
    },
  },
  {
    name: "escalate_to_owner",
    description:
      "Hands the conversation to the business owner. Use for anything outside the business facts, a frustrated customer, or an emergency with no open slots today.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string" },
      },
      required: ["reason"],
    },
  },
  {
    name: "score_lead",
    description:
      "Records the job category, urgency, and a short summary once they're known. Call this once qualification is done, before offering appointment slots.",
    input_schema: {
      type: "object",
      properties: {
        job_type: {
          type: "string",
          enum: ["replacement", "repair", "maintenance"],
          description: "Which of these three categories the job falls into — used for scoring, not shown to the customer.",
        },
        urgency: { type: "string", enum: ["emergency", "soon", "flexible"] },
        notes: { type: "string", description: "A short plain-language summary of what the customer described, e.g. 'AC not cooling, 2nd floor'." },
      },
      required: ["job_type", "urgency", "notes"],
    },
  },
];

export async function executeAgentTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext
): Promise<ToolResult> {
  switch (name) {
    case "get_availability":
      return getAvailabilityTool(ctx);
    case "book_slot":
      return bookSlotTool(input, ctx);
    case "send_payment_link":
      return sendPaymentLinkTool(input);
    case "escalate_to_owner":
      return escalateToOwnerTool(input, ctx);
    case "score_lead":
      return scoreLeadTool(input, ctx);
    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}

async function getAvailabilityTool(ctx: ToolContext): Promise<ToolResult> {
  const windows = await getOpenWindows(ctx.business.id, ctx.business.timezone);
  if (windows.length === 0) {
    return {
      content: "No open windows in the next 14 days. Tell the customer the owner will call to work something out, and call escalate_to_owner.",
    };
  }
  const lines = windows.map((w) => `${w.label} — starts_at=${w.startsAt}`);
  return { content: `Available windows:\n${lines.join("\n")}` };
}

async function bookSlotTool(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const startsAt = String(input.starts_at ?? "");
  const name = String(input.name ?? "");
  const address = String(input.address ?? "");
  const zip = String(input.zip ?? "");
  const jobType = String(input.job_type ?? "");

  const startDate = new Date(startsAt);
  if (isNaN(startDate.getTime())) {
    return { content: "starts_at is not a valid date. Call get_availability again and use its exact starts_at value.", isError: true };
  }

  const supabase = getSupabaseAdmin();

  // Idempotency guard: if this lead already has a held/confirmed
  // appointment, don't create a second one (e.g. the model re-calling
  // book_slot after the customer's closing "sounds good, thanks").
  const { data: existingAppointment } = await supabase
    .from("appointments")
    .select("id, starts_at")
    .eq("lead_id", ctx.lead.id)
    .in("status", ["held", "confirmed"])
    .maybeSingle();

  if (existingAppointment) {
    return {
      content: JSON.stringify({
        appointment_id: existingAppointment.id,
        already_booked: true,
        note: "This lead is already booked. Do not call book_slot again — just confirm the existing appointment.",
      }),
    };
  }

  // Re-verify the window is still open (race condition: two customers
  // booking the same window at once).
  const windows = await getOpenWindows(ctx.business.id, ctx.business.timezone);
  const match = windows.find((w) => w.startsAt === startDate.toISOString());
  if (!match) {
    return {
      content: "That time is no longer open. Call get_availability again and offer a different window.",
      isError: true,
    };
  }

  const { data: appointment, error: apptError } = await supabase
    .from("appointments")
    .insert({
      lead_id: ctx.lead.id,
      business_id: ctx.business.id,
      starts_at: match.startsAt,
      ends_at: match.endsAt,
      status: "held",
      deposit_status: "none",
    })
    .select("id")
    .single();

  if (apptError || !appointment) {
    console.error("Failed to insert appointment:", apptError?.message);
    return { content: "Booking failed on our end. Call escalate_to_owner.", isError: true };
  }

  const { data: updatedLead, error: leadError } = await supabase
    .from("leads")
    .update({ name, address, zip, job_type: jobType, status: "booked" })
    .eq("id", ctx.lead.id)
    .select("*")
    .single();

  if (leadError || !updatedLead) {
    console.error("Failed to update lead after booking:", leadError?.message);
  }

  await supabase.from("events").insert({
    business_id: ctx.business.id,
    lead_id: ctx.lead.id,
    type: "booked",
    data: { appointment_id: appointment.id, starts_at: match.startsAt },
  });

  const leadForAlert: Lead = updatedLead ?? { ...ctx.lead, name, address, zip, job_type: jobType, status: "booked" };
  ctx.lead = leadForAlert;

  try {
    await sendBookingLiveLine(ctx.business, leadForAlert, {
      bookedLabel: match.label,
      depositLine: ctx.business.deposit_cents > 0 ? `$${(ctx.business.deposit_cents / 100).toFixed(0)} ${ctx.business.deposit_label ?? "deposit"} not yet sent` : "",
      isAiAgent: ctx.isAiAgent,
    });
  } catch (err) {
    console.error("Failed to send booking Live Line:", err instanceof Error ? err.message : err);
  }

  return {
    content: JSON.stringify({
      appointment_id: appointment.id,
      booked_label: match.label,
      deposit_cents: ctx.business.deposit_cents,
    }),
  };
}

async function sendPaymentLinkTool(input: Record<string, unknown>): Promise<ToolResult> {
  const appointmentId = String(input.appointment_id ?? "");
  if (!appointmentId) {
    return { content: "appointment_id is required.", isError: true };
  }

  // Stripe isn't wired up until Phase 4 (SPEC.md build order). Until then,
  // degrade gracefully instead of failing the whole conversation.
  if (!process.env.STRIPE_SECRET_KEY) {
    console.warn(`send_payment_link called for appointment ${appointmentId} but Stripe isn't configured yet (Phase 4).`);
    return {
      content:
        "Online payment isn't set up yet. Tell the customer the deposit will be collected another way, and finish confirming the appointment.",
    };
  }

  return { content: "Stripe integration not yet implemented.", isError: true };
}

async function escalateToOwnerTool(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const reason = String(input.reason ?? "unspecified");
  const supabase = getSupabaseAdmin();

  const { error } = await supabase.from("leads").update({ status: "escalated" }).eq("id", ctx.lead.id);
  if (error) {
    console.error("Failed to mark lead escalated:", error.message);
  }

  await supabase.from("events").insert({
    business_id: ctx.business.id,
    lead_id: ctx.lead.id,
    type: "escalated",
    data: { reason },
  });

  try {
    await sendEscalationAlert(ctx.business, ctx.lead, {
      reason,
      lastCustomerMessage: ctx.lastCustomerMessage,
      isAiAgent: ctx.isAiAgent,
    });
  } catch (err) {
    console.error("Failed to send escalation alert:", err instanceof Error ? err.message : err);
  }

  return { content: "The owner has been notified and will follow up with the customer directly." };
}

async function scoreLeadTool(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
  const jobType = String(input.job_type ?? "");
  const urgency = String(input.urgency ?? "flexible") as Urgency;
  const notes = String(input.notes ?? "");

  const score = computeLeadScore({
    urgency,
    jobType,
    zip: ctx.lead.zip,
    facts: ctx.business.facts,
    timezone: ctx.business.timezone,
  });
  const estValueCents = computeEstValueCents(jobType, ctx.business.facts);

  const supabase = getSupabaseAdmin();
  const update: Record<string, unknown> = {
    job_type: jobType,
    urgency,
    summary: notes,
    score,
    est_value_cents: estValueCents,
  };
  if (ctx.lead.status === "new") update.status = "qualifying";

  const { error } = await supabase.from("leads").update(update).eq("id", ctx.lead.id);
  if (error) {
    console.error("Failed to record lead score:", error.message);
    return { content: "Failed to record score internally, but continue the conversation.", isError: true };
  }

  ctx.lead = { ...ctx.lead, ...update } as Lead;

  return { content: `Recorded: score ${score}, est. value $${(estValueCents / 100).toFixed(0)}.` };
}
