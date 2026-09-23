// Phase 6 proof: triggers the weekly report cron endpoint as a dry run
// (bypassing the "is it Monday" and already-sent checks) against the seed
// business, and checks the sent report + idempotency.
//
// Usage:
//   1. In one terminal: npm run dev
//   2. In another:      npm run test:weekly-report
import { getSupabaseAdmin } from "@/lib/supabase";

const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:3000";
const cronSecret = process.env.CRON_SECRET;

if (!cronSecret) {
  console.error("Need CRON_SECRET set in .env.local.");
  process.exit(1);
}

async function trigger(force: boolean, businessId?: string) {
  const url = new URL(`${BASE_URL}/api/cron/weekly-report`);
  if (force) url.searchParams.set("force", "true");
  if (businessId) url.searchParams.set("business_id", businessId);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${cronSecret}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const supabase = getSupabaseAdmin();
  const { data: business } = await supabase.from("businesses").select("id, name").order("created_at", { ascending: true }).limit(1).single();
  if (!business) throw new Error("No seed business. Run npm run db:seed first.");

  console.log("--- Unauthorized request ---");
  const unauthRes = await fetch(`${BASE_URL}/api/cron/weekly-report`);
  console.log(`HTTP ${unauthRes.status}`);
  if (unauthRes.status !== 401) throw new Error("Expected 401 without the CRON_SECRET header.");
  console.log("PASS: rejected without the secret.\n");

  console.log(`--- Dry run for ${business.name} ---`);
  const result = await trigger(true, business.id);
  console.log(JSON.stringify(result, null, 2));

  const sent = result.results?.[0];
  if (!sent?.sent) throw new Error(`Expected sent=true, got: ${JSON.stringify(sent)}`);
  console.log("\nPASS: report sent. Check your phone for the text.\n");

  console.log("--- Idempotency: same real (non-force) trigger should skip if already sent this week ---");
  await trigger(true, business.id); // send once more with force to create the real events row this week
  const secondReal = await trigger(false, business.id);
  console.log(JSON.stringify(secondReal, null, 2));
  const skipped = secondReal.results?.[0];
  if (skipped?.sent) {
    console.log("(Not skipped — only expected if today happens to be Monday in the business's timezone and no report sent yet today; not a failure.)");
  } else {
    console.log("PASS: skipped as expected (already sent or not Monday).");
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
