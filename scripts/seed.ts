// Creates (or updates) one test business so later phases have something to
// call, text, and book against. Values come from .env.local (SEED_*) so you
// never have to edit code — just edit .env.local and re-run.
//
// Usage: npm run db:seed
import { getSupabaseAdmin } from "@/lib/supabase";

const name = process.env.SEED_BUSINESS_NAME || "Queen City Comfort";
const ownerName = process.env.SEED_OWNER_NAME || "Steven";
const ownerCell = process.env.SEED_OWNER_CELL || "";
const forwardNumber = process.env.SEED_FORWARD_NUMBER || "";
const timezone = process.env.SEED_TIMEZONE || "America/New_York";
const trade = process.env.SEED_TRADE || "HVAC";
const city = process.env.SEED_CITY || "Charlotte";
const depositCents = Number(process.env.SEED_DEPOSIT_CENTS || 8900);
const depositLabel = process.env.SEED_DEPOSIT_LABEL || "diagnostic fee";
const avgTicketCents = Number(process.env.SEED_AVG_TICKET_CENTS || 67500);

if (!ownerCell) {
  console.error(
    "SEED_OWNER_CELL is not set in .env.local. Add your own cell number (e.g. +19805551234) so Phase 1+ test scripts have an owner to text, then re-run."
  );
  process.exit(1);
}

const facts = {
  name,
  trade,
  city,
  services: ["repair", "maintenance", "replacement"],
  service_area_zips: (process.env.SEED_SERVICE_AREA_ZIPS || "28277,28226,28210")
    .split(",")
    .map((z) => z.trim()),
  hours: process.env.SEED_HOURS || "Mon-Fri 8am-6pm, emergency calls after hours",
  emergency_after_hours: true,
  price_ranges: {
    diagnostic: "$89",
    common_repair: "$250-$650",
    replacement: "$6,500-$12,500",
  },
  warranty: process.env.SEED_WARRANTY || "1 year parts and labor on all repairs",
  licensing: process.env.SEED_LICENSING || "",
  never_say: [],
  avg_ticket_cents: avgTicketCents,
};

async function main() {
  const supabase = getSupabaseAdmin();

  const { data: existing, error: findError } = await supabase
    .from("businesses")
    .select("id")
    .eq("name", name)
    .maybeSingle();

  if (findError) {
    console.error("Could not query businesses:", findError.message);
    process.exit(1);
  }

  const row = {
    name,
    owner_name: ownerName,
    owner_cell: ownerCell,
    forward_number: forwardNumber,
    timezone,
    facts,
    deposit_cents: depositCents,
    deposit_label: depositLabel,
    plan: "catch",
    status: "trial",
  };

  let businessId: string;

  if (existing) {
    const { error } = await supabase.from("businesses").update(row).eq("id", existing.id);
    if (error) {
      console.error("Failed to update seed business:", error.message);
      process.exit(1);
    }
    businessId = existing.id;
    console.log(`Updated existing business "${name}" (${businessId})`);
  } else {
    const { data, error } = await supabase.from("businesses").insert(row).select("id").single();
    if (error) {
      console.error("Failed to insert seed business:", error.message);
      process.exit(1);
    }
    businessId = data.id;
    console.log(`Created business "${name}" (${businessId})`);
  }

  // Replace availability with the default Mon-Fri, two-tech windows from the spec.
  const { error: deleteError } = await supabase
    .from("availability")
    .delete()
    .eq("business_id", businessId);
  if (deleteError) {
    console.error("Failed to clear old availability:", deleteError.message);
    process.exit(1);
  }

  const windows = [
    { start_time: "08:00", end_time: "10:00" },
    { start_time: "10:00", end_time: "12:00" },
    { start_time: "13:00", end_time: "15:00" },
    { start_time: "15:00", end_time: "17:00" },
  ];

  const availabilityRows = [1, 2, 3, 4, 5].flatMap((weekday) =>
    windows.map((w) => ({
      business_id: businessId,
      weekday,
      start_time: w.start_time,
      end_time: w.end_time,
      slots_per_window: 2,
      window_minutes: 120,
    }))
  );

  const { error: availError } = await supabase.from("availability").insert(availabilityRows);
  if (availError) {
    console.error("Failed to insert availability:", availError.message);
    process.exit(1);
  }

  console.log(`Seeded ${availabilityRows.length} availability windows (Mon-Fri, 4 windows/day, 2 slots each).`);
  console.log("\nSeed complete.");
}

main();
