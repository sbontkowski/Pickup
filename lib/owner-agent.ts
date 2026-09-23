import type Anthropic from "@anthropic-ai/sdk";
import { DateTime } from "luxon";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTwilioClient } from "@/lib/twilio";
import { runToolLoop } from "@/lib/anthropic";
import { env } from "@/lib/env";
import type { Business } from "@/lib/types";

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const OWNER_TOOLS: Anthropic.Tool[] = [
  {
    name: "send_message_to_lead",
    description: "Sends a text to a specific customer/lead on the owner's behalf, e.g. 'text Maria we're running 20 late'.",
    input_schema: {
      type: "object",
      properties: {
        lead_query: { type: "string", description: "The customer's name or phone number, as the owner referred to them." },
        message: { type: "string" },
      },
      required: ["lead_query", "message"],
    },
  },
  {
    name: "update_availability",
    description: "Closes or opens a bookable window, e.g. 'close Friday afternoon' or 'open Sat 8-12'.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["close", "open"] },
        weekday: { type: "string", description: "e.g. Monday, Tuesday, ... Saturday, Sunday" },
        start_time: { type: "string", description: "24-hour HH:MM, required for 'open', optional for 'close' (omit to close the whole day)" },
        end_time: { type: "string", description: "24-hour HH:MM, required for 'open', optional for 'close'" },
      },
      required: ["action", "weekday"],
    },
  },
  {
    name: "set_business_status",
    description: "Pauses or resumes automatic text-backs to missed calls.",
    input_schema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["paused", "active"] },
      },
      required: ["status"],
    },
  },
];

interface OwnerToolContext {
  business: Business;
}

async function getActivitySummary(businessId: string) {
  const supabase = getSupabaseAdmin();
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const fourteenDaysAhead = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: calls }, { data: leads }, { data: appointments }] = await Promise.all([
    supabase
      .from("calls")
      .select("caller_phone, missed_at, texted_at, caller_type")
      .eq("business_id", businessId)
      .gte("missed_at", sevenDaysAgo)
      .order("missed_at", { ascending: false }),
    supabase
      .from("leads")
      .select("name, phone, job_type, urgency, status, score, created_at")
      .eq("business_id", businessId)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false }),
    supabase
      .from("appointments")
      .select("starts_at, status, deposit_status, leads(name, phone)")
      .eq("business_id", businessId)
      .gte("starts_at", sevenDaysAgo)
      .lte("starts_at", fourteenDaysAhead)
      .order("starts_at", { ascending: true }),
  ]);

  return { calls: calls ?? [], leads: leads ?? [], appointments: appointments ?? [] };
}

function buildOwnerSystemPrompt(business: Business, activity: Awaited<ReturnType<typeof getActivitySummary>>): string {
  const now = DateTime.now().setZone(business.timezone);

  return `You are the owner's assistant for ${business.name}. The owner just texted you a request. Answer using ONLY the data below — never invent numbers or details.

Current time: ${now.toFormat("ccc M/d h:mm a")} (${business.timezone})

Calls, last 7 days:
${JSON.stringify(activity.calls, null, 2)}

Leads, last 7 days:
${JSON.stringify(activity.leads, null, 2)}

Appointments, past 7 days through next 14 days:
${JSON.stringify(activity.appointments, null, 2)}

You can also take these actions:
- send_message_to_lead: text a specific customer on the owner's behalf. Always confirm back to the owner that you sent it.
- update_availability: close or open a bookable window.
- set_business_status: pause or resume automatic text-backs to missed calls.

Be brief — one or two short sentences, plain language, no emoji.

If the owner asks for anything else — anything you can't answer from the data above or do with these three actions — reply with exactly: "I can't do that yet — text Steven at ${env.SUPPORT_CELL}."`;
}

async function executeOwnerTool(
  name: string,
  input: Record<string, unknown>,
  ctx: OwnerToolContext
): Promise<{ content: string; isError?: boolean }> {
  switch (name) {
    case "send_message_to_lead":
      return sendMessageToLeadTool(input, ctx);
    case "update_availability":
      return updateAvailabilityTool(input, ctx);
    case "set_business_status":
      return setBusinessStatusTool(input, ctx);
    default:
      return { content: `Unknown tool: ${name}`, isError: true };
  }
}

async function sendMessageToLeadTool(input: Record<string, unknown>, ctx: OwnerToolContext) {
  const query = String(input.lead_query ?? "").trim();
  const message = String(input.message ?? "").trim();
  if (!query || !message) {
    return { content: "lead_query and message are both required.", isError: true };
  }

  const supabase = getSupabaseAdmin();
  const { data: lead } = await supabase
    .from("leads")
    .select("id, name, phone")
    .eq("business_id", ctx.business.id)
    .or(`name.ilike.%${query}%,phone.ilike.%${query}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lead) {
    return { content: `Couldn't find a lead matching "${query}". Tell the owner.`, isError: true };
  }

  const client = getTwilioClient();
  let sid: string | null = null;
  try {
    const sent = await client.messages.create({ from: env.TWILIO_NUMBER, to: lead.phone, body: message });
    sid = sent.sid;
  } catch (err) {
    console.error("Failed to send owner-authored message:", err instanceof Error ? err.message : err);
    return { content: `Failed to text ${lead.name ?? lead.phone}. Tell the owner it didn't send.`, isError: true };
  }

  await supabase.from("messages").insert({ lead_id: lead.id, role: "owner", body: message, twilio_sid: sid });
  await supabase.from("events").insert({ business_id: ctx.business.id, lead_id: lead.id, type: "owner_message", data: { message } });

  return { content: `Sent to ${lead.name ?? lead.phone}.` };
}

async function updateAvailabilityTool(input: Record<string, unknown>, ctx: OwnerToolContext) {
  const action = String(input.action ?? "");
  const weekdayName = String(input.weekday ?? "").toLowerCase().trim();
  const weekday = WEEKDAY_NAMES[weekdayName];
  if (weekday === undefined) {
    return { content: `Didn't recognize the day "${input.weekday}".`, isError: true };
  }

  const supabase = getSupabaseAdmin();
  const startTime = input.start_time ? String(input.start_time) : undefined;
  const endTime = input.end_time ? String(input.end_time) : undefined;

  if (action === "open") {
    if (!startTime || !endTime) {
      return { content: "start_time and end_time are required to open a window.", isError: true };
    }
    const { error } = await supabase.from("availability").insert({
      business_id: ctx.business.id,
      weekday,
      start_time: startTime,
      end_time: endTime,
      slots_per_window: 1,
      window_minutes: 120,
    });
    if (error) {
      console.error("Failed to open availability window:", error.message);
      return { content: "Failed to update availability.", isError: true };
    }
    return { content: `Opened ${weekdayName} ${startTime}-${endTime}.` };
  }

  if (action === "close") {
    let query = supabase.from("availability").delete().eq("business_id", ctx.business.id).eq("weekday", weekday);
    if (startTime) query = query.gte("start_time", startTime);
    if (endTime) query = query.lte("end_time", endTime);
    const { error } = await query;
    if (error) {
      console.error("Failed to close availability window:", error.message);
      return { content: "Failed to update availability.", isError: true };
    }
    return { content: `Closed ${weekdayName}${startTime ? ` ${startTime}-${endTime}` : " (all day)"}.` };
  }

  return { content: `Unknown action "${action}".`, isError: true };
}

async function setBusinessStatusTool(input: Record<string, unknown>, ctx: OwnerToolContext) {
  const status = String(input.status ?? "");
  if (status !== "paused" && status !== "active") {
    return { content: "status must be 'paused' or 'active'.", isError: true };
  }
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("businesses").update({ status }).eq("id", ctx.business.id);
  if (error) {
    console.error("Failed to update business status:", error.message);
    return { content: "Failed to update status.", isError: true };
  }
  return { content: status === "paused" ? "Paused — no more automatic text-backs until resumed." : "Resumed — automatic text-backs are back on." };
}

export async function runOwnerAgent(business: Business, ownerMessage: string): Promise<string> {
  const activity = await getActivitySummary(business.id);
  const ctx: OwnerToolContext = { business };

  const result = await runToolLoop({
    system: buildOwnerSystemPrompt(business, activity),
    tools: OWNER_TOOLS,
    messages: [{ role: "user", content: ownerMessage }],
    executeTool: (name, input) => executeOwnerTool(name, input, ctx),
  });

  if (result.hitIterationCap) {
    return `I can't do that yet — text Steven at ${env.SUPPORT_CELL}.`;
  }

  return result.text || `I can't do that yet — text Steven at ${env.SUPPORT_CELL}.`;
}
