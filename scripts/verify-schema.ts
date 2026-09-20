// Proves Phase 1's migration ran: every table from 0001_init.sql exists and
// is queryable with the service-role key.
//
// Usage: npm run db:verify
import { getSupabaseAdmin } from "@/lib/supabase";

const TABLES = [
  "businesses",
  "availability",
  "calls",
  "leads",
  "messages",
  "appointments",
  "payments",
  "events",
] as const;

async function main() {
  const supabase = getSupabaseAdmin();
  let allOk = true;

  for (const table of TABLES) {
    // Not head:true — HEAD responses have no body, so PostgREST error
    // details (e.g. "table not found") get lost and error.message is empty.
    const { error, count } = await supabase
      .from(table)
      .select("id", { count: "exact" })
      .limit(1);

    if (error) {
      allOk = false;
      console.log(`FAIL  ${table.padEnd(14)} ${error.message}`);
    } else {
      console.log(`OK    ${table.padEnd(14)} (${count ?? 0} rows)`);
    }
  }

  if (!allOk) {
    console.error(
      "\nSome tables are missing. Paste supabase/migrations/0001_init.sql into the Supabase SQL Editor and run it, then re-run this script."
    );
    process.exit(1);
  }

  console.log("\nAll 8 tables exist and are reachable with the service key.");
}

main();
