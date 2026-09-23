// Phase 5 proof: sends a series of real owner commands (from the seed
// business's owner_cell) through /api/twilio/sms and checks both the
// reply and the resulting database state.
//
// Usage:
//   1. In one terminal: npm run dev
//   2. In another:      npm run test:owner
import twilio from "twilio";
import { getSupabaseAdmin } from "@/lib/supabase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const url = `${BASE_URL}/api/twilio/sms`;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const ownerCell = process.env.SEED_OWNER_CELL;

if (!authToken || !ownerCell) {
  console.error("Need TWILIO_AUTH_TOKEN and SEED_OWNER_CELL set in .env.local.");
  process.exit(1);
}

async function send(body: string): Promise<void> {
  const params = { From: ownerCell!, To: process.env.TWILIO_NUMBER || "", Body: body, MessageSid: `SM${Math.random().toString(16).slice(2).padEnd(32, "0")}` };
  const sig = twilio.getExpectedTwilioSignature(authToken!, url, params);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": sig },
    body: new URLSearchParams(params).toString(),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
}

async function lastOwnerCommandReply(supabase: ReturnType<typeof getSupabaseAdmin>, businessId: string): Promise<string> {
  const { data } = await supabase
    .from("events")
    .select("data")
    .eq("business_id", businessId)
    .eq("type", "owner_command")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();
  return (data?.data as { reply?: string })?.reply ?? "(no reply logged)";
}

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase.from("businesses").select("*").order("created_at", { ascending: true }).limit(1).single();
  if (!business) throw new Error("No seed business. Run npm run db:seed first.");

  console.log(`Testing owner commands as ${ownerCell} for ${business.name}\n`);

  const informational = ["who called today", "any emergencies", "how many missed this week"];
  for (const q of informational) {
    console.log(`Owner: ${q}`);
    await send(q);
    await new Promise((r) => setTimeout(r, 2000));
    console.log(`Reply: ${await lastOwnerCommandReply(supabase, business.id)}\n`);
  }

  // send_message_to_lead needs a real, deliverable phone number to prove
  // actual send + logging (not just the tool-call plumbing) — synthetic
  // test numbers from other test scripts can't receive real SMS while
  // toll-free verification is pending. Use a dedicated lead pointed at
  // your own verified cell as the "customer" for this one check.
  const testLeadPhone = ownerCell!;
  await supabase.from("leads").delete().eq("phone", testLeadPhone).eq("business_id", business.id);
  const { data: testLead } = await supabase
    .from("leads")
    .insert({ business_id: business.id, phone: testLeadPhone, name: "Jordan Test", status: "booked" })
    .select("id")
    .single();

  console.log("Owner: text Jordan we're running 20 late");
  await send("text Jordan we're running 20 late");
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Reply: ${await lastOwnerCommandReply(supabase, business.id)}`);

  const { data: msg } = await supabase
    .from("messages")
    .select("role, body")
    .eq("lead_id", testLead!.id)
    .eq("role", "owner")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  console.log(`Logged message: ${JSON.stringify(msg)}`);
  console.log("(Check your phone — you should have received this as the test \"customer\".)\n");
  if (!msg) throw new Error("send_message_to_lead did not send + log a message row.");

  console.log("Owner: close Friday afternoon");
  await send("close Friday afternoon");
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Reply: ${await lastOwnerCommandReply(supabase, business.id)}`);
  const { data: fridayWindows } = await supabase.from("availability").select("*").eq("business_id", business.id).eq("weekday", 5);
  console.log(`Friday windows remaining: ${JSON.stringify(fridayWindows)}\n`);

  console.log("Owner: open Sat 8-12");
  await send("open Sat 8-12");
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Reply: ${await lastOwnerCommandReply(supabase, business.id)}`);
  const { data: satWindows } = await supabase.from("availability").select("*").eq("business_id", business.id).eq("weekday", 6);
  console.log(`Saturday windows: ${JSON.stringify(satWindows)}\n`);
  if (!satWindows?.some((w) => w.start_time.startsWith("08:00"))) {
    throw new Error("open Sat 8-12 did not create an 8am window.");
  }

  console.log("Owner: pause");
  await send("pause");
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Reply: ${await lastOwnerCommandReply(supabase, business.id)}`);
  const { data: paused } = await supabase.from("businesses").select("status").eq("id", business.id).single();
  console.log(`Business status: ${paused!.status}\n`);
  if (paused!.status !== "paused") throw new Error("pause did not set status to paused.");

  console.log("Owner: resume");
  await send("resume");
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`Reply: ${await lastOwnerCommandReply(supabase, business.id)}`);
  const { data: resumed } = await supabase.from("businesses").select("status").eq("id", business.id).single();
  console.log(`Business status: ${resumed!.status}\n`);
  if (resumed!.status === "paused") throw new Error("resume did not un-pause the business.");

  console.log("Owner: what's the capital of France");
  await send("what's the capital of France");
  await new Promise((r) => setTimeout(r, 2000));
  const fallback = await lastOwnerCommandReply(supabase, business.id);
  console.log(`Reply: ${fallback}\n`);
  if (!fallback.includes("text Steven")) {
    throw new Error("Out-of-scope request did not get the expected fallback.");
  }

  console.log("PASS: all owner-agent commands behaved as expected.");
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
