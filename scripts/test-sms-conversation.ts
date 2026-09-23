// Phase 3 proof: drives a full booking conversation through /api/twilio/sms
// using a synthetic customer number, signing each request exactly like
// Twilio would. Prints the agent's replies (read from the `messages` table,
// since the SMS webhook always returns empty TwiML) and checks that a
// booking actually happened.
//
// Real SMS delivery to the synthetic number will fail (it isn't verified in
// Twilio) — that's expected and handled gracefully by the app. This script
// proves the conversation logic, database writes, and tool calls are
// correct; it does not prove real text delivery to an arbitrary customer.
//
// Usage:
//   1. In one terminal: npm run dev
//   2. In another:      npm run test:sms
import twilio from "twilio";
import { getSupabaseAdmin } from "@/lib/supabase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const url = `${BASE_URL}/api/twilio/sms`;

const authToken = process.env.TWILIO_AUTH_TOKEN;
if (!authToken) {
  console.error("Need TWILIO_AUTH_TOKEN set in .env.local.");
  process.exit(1);
}

const CUSTOMER_PHONE = process.env.TEST_CUSTOMER_PHONE || "+15555550100";

const TURNS = [
  "Hi, my AC stopped cooling today",
  "My name is Alex Rivera, address is 9124 Blakeney Heath Rd, 28277",
  "It's not cooling at all, it's an emergency",
  "The first available time works for me",
  "Sounds good, thank you",
];

async function seedCall(supabase: ReturnType<typeof getSupabaseAdmin>, businessId: string) {
  // A real conversation starts from a missed-call text-back, which creates
  // the calls row that maps this phone number to a business (see Phase 2).
  // Simulate that row directly so this script can run standalone.
  await supabase.from("calls").insert({
    business_id: businessId,
    caller_phone: CUSTOMER_PHONE,
    twilio_call_sid: `CA${Math.random().toString(16).slice(2).padEnd(32, "0")}`,
    caller_type: "unknown",
    missed_at: new Date().toISOString(),
    texted_at: new Date().toISOString(),
  });
}

async function sendTurn(text: string, messageIndex: number) {
  const params: Record<string, string> = {
    From: CUSTOMER_PHONE,
    To: process.env.TWILIO_NUMBER || "",
    Body: text,
    MessageSid: `SM${Math.random().toString(16).slice(2).padEnd(32, "0")}`,
  };
  const signature = twilio.getExpectedTwilioSignature(authToken!, url, params);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) {
    console.error(`Turn ${messageIndex} failed: HTTP ${res.status}`, await res.text());
    process.exit(1);
  }
}

async function main() {
  const supabase = getSupabaseAdmin();

  const { data: business } = await supabase.from("businesses").select("*").limit(1).single();
  if (!business) {
    console.error("No seed business found. Run npm run db:seed first.");
    process.exit(1);
  }

  // Clean up any prior test lead for this synthetic number so each run
  // starts fresh.
  await supabase.from("leads").delete().eq("phone", CUSTOMER_PHONE);
  await seedCall(supabase, business.id);

  console.log(`Simulating a conversation from ${CUSTOMER_PHONE} to ${business.name}...\n`);

  for (let i = 0; i < TURNS.length; i++) {
    console.log(`Customer: ${TURNS[i]}`);
    await sendTurn(TURNS[i], i);
    await new Promise((r) => setTimeout(r, 1500));

    const { data: lead } = await supabase
      .from("leads")
      .select("*")
      .eq("phone", CUSTOMER_PHONE)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: lastAgentMessage } = await supabase
      .from("messages")
      .select("body")
      .eq("lead_id", lead?.id)
      .eq("role", "agent")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    console.log(`Agent:    ${lastAgentMessage?.body ?? "(no reply logged)"}\n`);
  }

  const { data: finalLead } = await supabase
    .from("leads")
    .select("*")
    .eq("phone", CUSTOMER_PHONE)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  console.log(`Final lead status: ${finalLead.status}`);
  console.log(`Score: ${finalLead.score}, est. value: $${((finalLead.est_value_cents ?? 0) / 100).toFixed(0)}`);
  console.log(`Job type: ${finalLead.job_type}, urgency: ${finalLead.urgency}`);
  console.log(`Address: ${finalLead.address}, ${finalLead.zip}`);

  const { data: appointment } = await supabase
    .from("appointments")
    .select("*")
    .eq("lead_id", finalLead.id)
    .maybeSingle();

  if (finalLead.status !== "booked" || !appointment) {
    console.error("\nFAIL: lead was not booked. Check the npm run dev terminal for errors.");
    process.exit(1);
  }

  console.log(`\nAppointment: ${appointment.starts_at} (status ${appointment.status})`);
  console.log("\nPASS: full booking conversation completed.");
}

main();
