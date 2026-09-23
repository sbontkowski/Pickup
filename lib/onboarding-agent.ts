import type Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase";
import { runToolLoop } from "@/lib/anthropic";
import { WEEKDAY_NAMES } from "@/lib/availability";
import type { Business } from "@/lib/types";

const SAVE_PROFILE_TOOL: Anthropic.Tool = {
  name: "save_business_profile",
  description:
    "Saves the completed onboarding answers. Call this ONLY after the owner has confirmed the summary you " +
    "echoed back (they said something like OK, yes, looks good, or gave corrections you then re-confirmed).",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Business name" },
      forward_number: { type: "string", description: "The phone number customers call, E.164 format if given" },
      trade: { type: "string", description: "e.g. HVAC, plumbing, electrical" },
      city: { type: "string" },
      services: { type: "array", items: { type: "string" } },
      service_area_zips: { type: "array", items: { type: "string" }, description: "Zip codes or town names" },
      hours: { type: "string" },
      emergency_after_hours: { type: "boolean" },
      price_ranges: {
        type: "object",
        description: "Whatever price categories the owner gave, e.g. diagnostic, common_repair, replacement",
        properties: {
          diagnostic: { type: "string" },
          common_repair: { type: "string" },
          replacement: { type: "string" },
        },
      },
      deposit_cents: { type: "integer", description: "Deposit/diagnostic fee to collect at booking, in cents. 0 if none." },
      deposit_label: { type: "string", description: "e.g. 'diagnostic fee'" },
      availability_windows: {
        type: "array",
        description: "Every bookable window, one entry per day per window (expand 'Mon-Fri 8-10, 10-12' into one entry per day per slot).",
        items: {
          type: "object",
          properties: {
            weekday: { type: "string", description: "Monday .. Sunday" },
            start_time: { type: "string", description: "24-hour HH:MM" },
            end_time: { type: "string", description: "24-hour HH:MM" },
            slots_per_window: { type: "integer", description: "How many techs/jobs can be booked in this window at once" },
          },
          required: ["weekday", "start_time", "end_time", "slots_per_window"],
        },
      },
      warranty: { type: "string" },
      licensing: { type: "string" },
      never_say: { type: "array", items: { type: "string" }, description: "Things the front desk should never say" },
      avg_ticket_cents: { type: "integer", description: "Average job value in cents, for the weekly report" },
    },
    required: [
      "name", "forward_number", "trade", "services", "service_area_zips", "hours",
      "emergency_after_hours", "price_ranges", "deposit_cents", "availability_windows",
      "avg_ticket_cents",
    ],
  },
};

const ONBOARDING_SYSTEM_PROMPT = `You are walking a new home service business owner through setup over text, one question at a time. Be warm, brief, plain language, no emoji. Accept messy or out-of-order answers — don't force the owner to repeat something they already told you.

Ask these ten things, one at a time, in roughly this order (skip ahead if they already answered something):
1. Business name and the phone number customers call
2. Trade and services (e.g. "HVAC repair, maintenance, replacement, no duct cleaning")
3. Service area as zips or towns
4. Hours, and whether they take emergency calls after hours
5. Price ranges: diagnostic fee, common repairs, replacement range
6. Deposit or diagnostic fee to collect when booking, if any (0 if none)
7. Bookable windows (e.g. "Mon-Fri 8-10, 10-12, 1-3, 3-5, two techs")
8. Warranty and licensing lines they want quoted
9. Average ticket value, for the weekly report
10. Anything the front desk should never say

Once you have all ten, echo back a short plain-text summary of everything and ask them to reply OK or send corrections. Only call save_business_profile after they confirm — if they correct something, update your summary and confirm again before saving.`;

async function getOnboardingHistory(businessId: string): Promise<Anthropic.MessageParam[]> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("events")
    .select("data, created_at")
    .eq("business_id", businessId)
    .eq("type", "onboarding_message")
    .order("created_at", { ascending: true })
    .limit(60);

  return (data ?? []).map((row) => {
    const entry = row.data as { role: "owner" | "agent"; body: string };
    return { role: entry.role === "owner" ? "user" : "assistant", content: entry.body };
  });
}

async function logOnboardingMessage(businessId: string, role: "owner" | "agent", body: string) {
  const supabase = getSupabaseAdmin();
  await supabase.from("events").insert({ business_id: businessId, type: "onboarding_message", data: { role, body } });
}

async function saveBusinessProfileTool(input: Record<string, unknown>, business: Business): Promise<{ content: string; isError?: boolean }> {
  const supabase = getSupabaseAdmin();

  const facts = {
    trade: input.trade,
    city: input.city,
    services: input.services,
    service_area_zips: input.service_area_zips,
    hours: input.hours,
    emergency_after_hours: input.emergency_after_hours,
    price_ranges: input.price_ranges,
    warranty: input.warranty ?? "",
    licensing: input.licensing ?? "",
    never_say: input.never_say ?? [],
    avg_ticket_cents: input.avg_ticket_cents,
  };

  const { error: businessError } = await supabase
    .from("businesses")
    .update({
      name: input.name,
      forward_number: input.forward_number,
      deposit_cents: input.deposit_cents ?? 0,
      deposit_label: input.deposit_label ?? "deposit",
      facts,
    })
    .eq("id", business.id);

  if (businessError) {
    console.error("Failed to save business profile:", businessError.message);
    return { content: "Failed to save. Tell the owner something went wrong and to try confirming again.", isError: true };
  }

  const windows = Array.isArray(input.availability_windows) ? input.availability_windows : [];
  const rows = windows
    .map((w) => {
      const win = w as { weekday: string; start_time: string; end_time: string; slots_per_window: number };
      const weekday = WEEKDAY_NAMES[win.weekday.toLowerCase().trim()];
      if (weekday === undefined) return null;
      return {
        business_id: business.id,
        weekday,
        start_time: win.start_time,
        end_time: win.end_time,
        slots_per_window: win.slots_per_window || 1,
        window_minutes: 120,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  await supabase.from("availability").delete().eq("business_id", business.id);
  if (rows.length > 0) {
    const { error: availError } = await supabase.from("availability").insert(rows);
    if (availError) {
      console.error("Failed to save availability windows:", availError.message);
    }
  }

  await supabase.from("events").insert({ business_id: business.id, type: "onboarded", data: {} });

  return { content: "Saved. Tell the owner they're all set, and mention the carrier forwarding code comes next." };
}

export async function runOnboardingAgent(business: Business, ownerMessage: string): Promise<string> {
  await logOnboardingMessage(business.id, "owner", ownerMessage);

  const messages = await getOnboardingHistory(business.id);

  const result = await runToolLoop({
    system: ONBOARDING_SYSTEM_PROMPT,
    tools: [SAVE_PROFILE_TOOL],
    messages,
    maxTokens: 2000,
    executeTool: (name, input) =>
      name === "save_business_profile"
        ? saveBusinessProfileTool(input, business)
        : Promise.resolve({ content: `Unknown tool: ${name}`, isError: true }),
  });

  const reply = result.hitIterationCap
    ? "Sorry, let's try that again — what would you like to change?"
    : result.text || "Got it — what's next?";

  await logOnboardingMessage(business.id, "agent", reply);
  return reply;
}
