import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

// Confirms the app booted and can reach Supabase with the service key.
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("businesses").select("id", { head: true, count: "exact" });
    if (error) throw error;
    return NextResponse.json({ ok: true, database: "reachable" });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown error" },
      { status: 500 }
    );
  }
}
