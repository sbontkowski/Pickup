import type Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTwilioClient, isValidTwilioRequest, formDataToParams } from "@/lib/twilio";
import { env } from "@/lib/env";
import { isGoogleAgentCallerId, looksLikeAutomatedAgentText } from "@/lib/caller-type";
import { runToolLoop } from "@/lib/anthropic";
import { AGENT_TOOLS, executeAgentTool, type ToolContext } from "@/lib/agent-tools";
import { buildSystemPrompt } from "@/lib/system-prompt";
import { runOwnerAgent } from "@/lib/owner-agent";
import { runOnboardingAgent } from "@/lib/onboarding-agent";
import type { Business, Lead } from "@/lib/types";

const EMPTY_TWIML = new Response("<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response></Response>", {
  headers: { "Content-Type": "text/xml" },
});

const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const MAX_AGENT_MESSAGES_PER_LEAD = 12;

async function sendSms(to: string, body: string): Promise<string | null> {
  try {
    const client = getTwilioClient();
    const message = await client.messages.create({ from: env.TWILIO_NUMBER, to, body });
    return message.sid;
  } catch (err) {
    console.error("Failed to send SMS:", err instanceof Error ? err.message : err);
    return null;
  }
}

export async function POST(request: Request) {
  const params = await formDataToParams(request);

  if (!isValidTwilioRequest(request, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params.From || "";
  const body = (params.Body || "").trim();
  const messageSid = params.MessageSid || "";

  const supabase = getSupabaseAdmin();

  if (STOP_KEYWORDS.has(body.toUpperCase())) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id, business_id")
      .eq("phone", from)
      .neq("status", "lost")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lead) {
      await supabase.from("leads").update({ status: "lost" }).eq("id", lead.id);
      await supabase.from("events").insert({ business_id: lead.business_id, lead_id: lead.id, type: "opted_out", data: {} });
    }

    await sendSms(from, "You've been unsubscribed and won't receive further texts. Reply START to opt back in.");
    return EMPTY_TWIML;
  }

  // Owner texts (from their own cell) go to the ask-your-desk agent, never
  // the customer-facing one.
  const { data: ownerBusiness } = await supabase
    .from("businesses")
    .select("*")
    .eq("owner_cell", from)
    .maybeSingle();

  if (ownerBusiness) {
    // No facts yet means onboarding was never finished — route there
    // instead of ask-your-desk. Onboarding logs its own transcript.
    const isOnboarded = Object.keys((ownerBusiness.facts as Record<string, unknown>) ?? {}).length > 0;

    let replyText: string;
    try {
      replyText = isOnboarded
        ? await runOwnerAgent(ownerBusiness as Business, body)
        : await runOnboardingAgent(ownerBusiness as Business, body);
    } catch (err) {
      console.error("Owner/onboarding agent failed:", err instanceof Error ? err.message : err);
      replyText = `Something went wrong on our end — text Steven at ${env.SUPPORT_CELL}.`;
    }

    if (isOnboarded) {
      await supabase.from("events").insert({
        business_id: ownerBusiness.id,
        type: "owner_command",
        data: { message: body, reply: replyText },
      });
    }

    await sendSms(from, replyText);
    return EMPTY_TWIML;
  }

  let lead: Lead | null = null;
  let business: Business | null = null;

  const { data: openLead, error: openLeadError } = await supabase
    .from("leads")
    .select("*")
    .eq("phone", from)
    .neq("status", "lost")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (openLeadError) {
    console.error("Failed to look up open lead:", openLeadError.message);
  }

  if (openLead) {
    lead = openLead as Lead;
    const { data: biz } = await supabase.from("businesses").select("*").eq("id", lead.business_id).maybeSingle();
    business = biz as Business | null;
  } else {
    // No open lead yet — this must be a reply to a text-back. Find which
    // business texted this number by way of the most recent missed call.
    const { data: recentCall } = await supabase
      .from("calls")
      .select("business_id")
      .eq("caller_phone", from)
      .order("missed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!recentCall) {
      console.error(`No open lead and no calls row for ${from}; cannot determine which business this belongs to.`);
      await sendSms(from, "Sorry, we couldn't find your request — please call the business directly.");
      return EMPTY_TWIML;
    }

    const { data: biz } = await supabase.from("businesses").select("*").eq("id", recentCall.business_id).maybeSingle();
    business = biz as Business | null;

    if (!business) {
      console.error(`calls row referenced business_id ${recentCall.business_id} which no longer exists.`);
      await sendSms(from, "Sorry, we couldn't find your request — please call the business directly.");
      return EMPTY_TWIML;
    }

    const { data: newLead, error: newLeadError } = await supabase
      .from("leads")
      .insert({ business_id: business.id, phone: from, status: "new" })
      .select("*")
      .single();

    if (newLeadError || !newLead) {
      console.error("Failed to create lead:", newLeadError?.message);
      await sendSms(from, "Sorry, something went wrong on our end — please call the business directly.");
      return EMPTY_TWIML;
    }
    lead = newLead as Lead;
  }

  if (!business || !lead) {
    return EMPTY_TWIML;
  }

  // Every inbound message is written to the database before the agent runs.
  await supabase.from("messages").insert({ lead_id: lead.id, role: "customer", body, twilio_sid: messageSid });

  const { count: agentMessageCount } = await supabase
    .from("messages")
    .select("*", { count: "exact", head: false })
    .eq("lead_id", lead.id)
    .eq("role", "agent");

  const isAiAgent = isGoogleAgentCallerId(from) || looksLikeAutomatedAgentText(body);
  const ctx: ToolContext = { business, lead, lastCustomerMessage: body, isAiAgent };

  if ((agentMessageCount ?? 0) >= MAX_AGENT_MESSAGES_PER_LEAD) {
    await executeAgentTool("escalate_to_owner", { reason: "Message cap reached" }, ctx);
    const replyText = "Let me get the owner to help you directly — they'll text you shortly.";
    const sid = await sendSms(from, replyText);
    await supabase.from("messages").insert({ lead_id: lead.id, role: "agent", body: replyText, twilio_sid: sid });
    return EMPTY_TWIML;
  }

  const { data: history } = await supabase
    .from("messages")
    .select("role, body")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: true })
    .limit(30);

  const messages: Anthropic.MessageParam[] = (history ?? [])
    .filter((m) => m.role === "customer" || m.role === "agent")
    .map((m) => ({ role: m.role === "customer" ? "user" : "assistant", content: m.body }));

  let replyText: string;

  try {
    replyText = await runAgentLoop(messages, business, ctx);
  } catch (err) {
    console.error("Agent loop failed:", err instanceof Error ? err.message : err);
    replyText = "Got it — the owner will text you shortly.";
    await executeAgentTool("escalate_to_owner", { reason: "Agent unavailable (API error)" }, ctx);
  }

  const sid = await sendSms(from, replyText);
  await supabase.from("messages").insert({ lead_id: lead.id, role: "agent", body: replyText, twilio_sid: sid });

  return EMPTY_TWIML;
}

async function runAgentLoop(
  initialMessages: Anthropic.MessageParam[],
  business: Business,
  ctx: ToolContext
): Promise<string> {
  const result = await runToolLoop({
    system: buildSystemPrompt(business),
    tools: AGENT_TOOLS,
    messages: initialMessages,
    executeTool: (name, input) => executeAgentTool(name, input, ctx),
  });

  if (!result.hitIterationCap) {
    return result.text || "Got it — one moment.";
  }

  // Ran out of tool-call budget for this turn without a plain-text reply.
  console.warn(`Agent hit the tool-call cap for lead ${ctx.lead.id}; escalating.`);
  await executeAgentTool("escalate_to_owner", { reason: "Agent could not resolve within tool-call budget" }, ctx);
  return "Let me get the owner to help you directly — they'll text you shortly.";
}
