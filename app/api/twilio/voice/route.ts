import { after } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getTwilioClient, isValidTwilioRequest, formDataToParams, escapeXml } from "@/lib/twilio";
import { isGoogleAgentCallerId } from "@/lib/caller-type";
import { env } from "@/lib/env";

function twiml(sayText: string): Response {
  const xml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${escapeXml(
    sayText
  )}</Say><Hangup/></Response>`;
  return new Response(xml, { headers: { "Content-Type": "text/xml" } });
}

const GENERIC_SAY = "Sorry, we can't take your call right now.";

export async function POST(request: Request) {
  const params = await formDataToParams(request);

  if (!isValidTwilioRequest(request, params)) {
    return new Response("Invalid signature", { status: 403 });
  }

  const from = params.From || "";
  const to = params.To || "";
  const forwardedFrom = params.ForwardedFrom || "";
  const callSid = params.CallSid || "";

  const supabase = getSupabaseAdmin();

  // businesses.forward_number should match ForwardedFrom (the real shop
  // line, when the carrier actually forwarded); fall back to To when the
  // carrier strips ForwardedFrom, or when testing by calling the Twilio
  // number directly.
  const lookupNumber = forwardedFrom || to;
  if (!forwardedFrom) {
    console.warn(`No ForwardedFrom on call ${callSid}; falling back to To=${to}`);
  }

  const { data: business, error: businessError } = await supabase
    .from("businesses")
    .select("*")
    .eq("forward_number", lookupNumber)
    .maybeSingle();

  if (businessError) {
    console.error("Error looking up business for call:", businessError.message);
  }

  const callerType = isGoogleAgentCallerId(from) ? "ai_agent" : "unknown";

  // Every inbound call is written to the database before anything else runs.
  const { error: insertError } = await supabase.from("calls").insert({
    business_id: business?.id ?? null,
    caller_phone: from,
    twilio_call_sid: callSid,
    caller_type: callerType,
    missed_at: new Date().toISOString(),
  });

  if (insertError) {
    console.error("Failed to insert calls row:", insertError.message);
  }

  if (!business) {
    console.error(`No business matched for call ${callSid} (looked up "${lookupNumber}")`);
    return twiml(GENERIC_SAY);
  }

  if (business.status === "paused") {
    console.log(`Business ${business.id} is paused; skipping text-back for call ${callSid}`);
    return twiml(GENERIC_SAY);
  }

  const facts = (business.facts ?? {}) as Record<string, unknown>;
  const trade = typeof facts.trade === "string" ? facts.trade : "job";

  // Respond to Twilio immediately; send the text-back afterward so the
  // voice response is never held up waiting on the SMS API.
  after(async () => {
    const client = getTwilioClient();
    try {
      await client.messages.create({
        from: env.TWILIO_NUMBER,
        to: from,
        body: `Hi, this is ${business.name} — sorry we missed your call! What's going on with your ${trade}? Reply here and we'll get you on the schedule. (Text STOP to opt out)`,
      });

      const { error: updateError } = await supabase
        .from("calls")
        .update({ texted_at: new Date().toISOString() })
        .eq("twilio_call_sid", callSid);

      if (updateError) {
        console.error("Failed to record texted_at:", updateError.message);
      }
    } catch (err) {
      console.error("Failed to send text-back SMS:", err instanceof Error ? err.message : err);
    }
  });

  return twiml(`Thanks for calling ${business.name}. We're on a job right now. We're texting you this second so we can get you taken care of.`);
}
