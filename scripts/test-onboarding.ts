// Phase 6 proof: drives a full 10-question onboarding conversation as a
// brand-new business (empty facts, matching what the subscription webhook
// creates) through /api/twilio/sms, and checks the final business row +
// availability windows.
//
// Usage:
//   1. In one terminal: npm run dev
//   2. In another:      npm run test:onboarding
import twilio from "twilio";
import { getSupabaseAdmin } from "@/lib/supabase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const url = `${BASE_URL}/api/twilio/sms`;
const authToken = process.env.TWILIO_AUTH_TOKEN;

if (!authToken) {
  console.error("Need TWILIO_AUTH_TOKEN set in .env.local.");
  process.exit(1);
}

const TEST_OWNER_CELL = "+15555550500";

const TURNS = [
  "hi",
  "Rivera Plumbing, customers call 704-555-0100",
  "plumbing repair and installation, no septic work",
  "28277, 28226, 28210",
  "Mon-Fri 7am-7pm, yes we take emergencies after hours",
  "diagnostic is $79, common repairs $150-$500, replacements $2000-$6000",
  "we collect a $79 deposit at booking",
  "Mon-Fri 8-10, 10-12, 1-3, 3-5, two techs at a time",
  "1 year warranty on labor, licensed and insured NC #12345",
  "average ticket is about $450",
  "never say we can beat a competitor's price",
  "OK looks good",
];

async function send(body: string): Promise<void> {
  const params = { From: TEST_OWNER_CELL, To: process.env.TWILIO_NUMBER || "", Body: body, MessageSid: `SM${Math.random().toString(16).slice(2).padEnd(32, "0")}` };
  const sig = twilio.getExpectedTwilioSignature(authToken!, url, params);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

async function lastAgentReply(supabase: ReturnType<typeof getSupabaseAdmin>, businessId: string): Promise<string> {
  const { data } = await supabase
    .from("events")
    .select("data")
    .eq("business_id", businessId)
    .eq("type", "onboarding_message")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return (data?.data as { body?: string })?.body ?? "(no reply logged)";
}

async function main() {
  const supabase = getSupabaseAdmin();

  await supabase.from("businesses").delete().eq("owner_cell", TEST_OWNER_CELL);
  const { data: business, error } = await supabase
    .from("businesses")
    .insert({ name: "New Client", owner_cell: TEST_OWNER_CELL, plan: "catch", status: "trial", facts: {} })
    .select("*")
    .single();
  if (error || !business) throw new Error(`Failed to create test business: ${error?.message}`);

  console.log(`Created test business ${business.id} with empty facts (simulating a fresh signup).\n`);

  for (const turn of TURNS) {
    console.log(`Owner: ${turn}`);
    await send(turn);
    await new Promise((r) => setTimeout(r, 2500));
    console.log(`Agent: ${await lastAgentReply(supabase, business.id)}\n`);
  }

  const { data: finalBusiness } = await supabase.from("businesses").select("*").eq("id", business.id).single();
  const { data: windows } = await supabase.from("availability").select("*").eq("business_id", business.id).order("weekday");

  console.log("Final business row:");
  console.log(JSON.stringify(finalBusiness, null, 2));
  console.log(`\nAvailability windows saved: ${windows?.length ?? 0}`);

  if (finalBusiness!.name === "New Client" || Object.keys(finalBusiness!.facts ?? {}).length === 0) {
    throw new Error("Onboarding did not save a business profile.");
  }
  if (!windows || windows.length === 0) {
    throw new Error("Onboarding did not save any availability windows.");
  }
  if (finalBusiness!.deposit_cents !== 7900) {
    throw new Error(`Expected deposit_cents=7900, got ${finalBusiness!.deposit_cents}`);
  }

  console.log("\nPASS: onboarding conversation produced a complete business profile.");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
