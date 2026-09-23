// Phase 2 proof: simulates a real, correctly-signed Twilio voice webhook
// request against a locally running `npm run dev`, exactly like Twilio's
// servers would send it, then checks the database and (for real) your
// phone for the text-back.
//
// Usage:
//   1. In one terminal: npm run dev
//   2. In another:      npm run test:voice
import twilio from "twilio";
import { getSupabaseAdmin } from "@/lib/supabase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const PATH = "/api/twilio/voice";
const url = `${BASE_URL}${PATH}`;

const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioNumber = process.env.TWILIO_NUMBER;
const ownerCell = process.env.SEED_OWNER_CELL;

if (!authToken || !twilioNumber || !ownerCell) {
  console.error(
    "Need TWILIO_AUTH_TOKEN, TWILIO_NUMBER, and SEED_OWNER_CELL set in .env.local."
  );
  process.exit(1);
}

const callSid = `CA${Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("")}`;

const params: Record<string, string> = {
  From: ownerCell,
  To: twilioNumber,
  ForwardedFrom: twilioNumber,
  CallSid: callSid,
};

const signature = twilio.getExpectedTwilioSignature(authToken, url, params);

async function main() {
  console.log(`POST ${url}`);
  console.log("Simulated call from your own cell, as if it had just been forwarded to Twilio.");

  const body = new URLSearchParams(params);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": signature,
    },
    body: body.toString(),
  });

  const text = await res.text();
  console.log(`\nHTTP ${res.status}`);
  console.log(text);

  if (!res.ok) {
    console.error("\nRequest failed — see server logs (the terminal running npm run dev).");
    process.exit(1);
  }

  if (!text.includes("<Say") || !text.includes("<Hangup")) {
    console.error("\nResponse is not the expected TwiML (missing <Say>/<Hangup>).");
    process.exit(1);
  }

  console.log("\nWaiting 3s for the background text-back to send...");
  await new Promise((r) => setTimeout(r, 3000));

  const supabase = getSupabaseAdmin();
  const { data: call, error } = await supabase
    .from("calls")
    .select("*")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();

  if (error || !call) {
    console.error("\nCould not find the calls row for this test:", error?.message);
    process.exit(1);
  }

  console.log(`\ncalls row: missed_at=${call.missed_at} texted_at=${call.texted_at}`);

  if (!call.texted_at) {
    console.error(
      "\ntexted_at is empty — the text-back did not send. Check the npm run dev terminal for errors."
    );
    process.exit(1);
  }

  console.log(
    `\nPASS: call was logged and the text-back was sent. Check the phone at ${ownerCell} for the text.`
  );
}

main();
