import { getSupabaseAdmin } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendWeeklyReport } from "@/lib/weekly-report";
import type { Business } from "@/lib/types";

// Vercel Cron calls this on schedule with Authorization: Bearer $CRON_SECRET
// (see vercel.json). For manual/dry-run testing, pass the same header plus
// ?force=true to bypass the "is it actually Monday" and already-sent checks,
// and optionally &business_id=... to target just one business.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";
  const onlyBusinessId = url.searchParams.get("business_id");

  const supabase = getSupabaseAdmin();
  let query = supabase.from("businesses").select("*").not("owner_cell", "is", null);
  if (onlyBusinessId) query = query.eq("id", onlyBusinessId);

  const { data: businesses, error } = await query;
  if (error) {
    console.error("Failed to load businesses for weekly report:", error.message);
    return new Response("Failed to load businesses", { status: 500 });
  }

  const results = [];
  for (const business of (businesses ?? []) as Business[]) {
    try {
      results.push(await sendWeeklyReport(business, force));
    } catch (err) {
      console.error(`Weekly report failed for business ${business.id}:`, err instanceof Error ? err.message : err);
      results.push({ businessId: business.id, sent: false, reason: "unexpected error" });
    }
  }

  return Response.json({ results });
}
