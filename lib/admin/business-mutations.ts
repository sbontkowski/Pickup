import type { getSupabaseAdmin } from "@/lib/supabase";
import type { Business } from "@/lib/types";

type Supabase = ReturnType<typeof getSupabaseAdmin>;

export interface MutationResult {
  ok: boolean;
  error?: string;
}

// JSON.parse lives here (not just in the form layer) so a typo can never
// write malformed `facts` or 500 the page — just come back as a form error.
export async function updateBusinessFacts(
  supabase: Supabase,
  businessId: string,
  rawFactsJson: string
): Promise<MutationResult> {
  let facts: Record<string, unknown>;
  try {
    facts = JSON.parse(rawFactsJson);
  } catch {
    return { ok: false, error: "That's not valid JSON — fix the syntax and try again." };
  }
  if (typeof facts !== "object" || facts === null || Array.isArray(facts)) {
    return { ok: false, error: 'Facts must be a JSON object, e.g. { "trade": "HVAC" }.' };
  }

  const { data: before } = await supabase.from("businesses").select("facts").eq("id", businessId).maybeSingle();

  const { error } = await supabase.from("businesses").update({ facts }).eq("id", businessId);
  if (error) {
    return { ok: false, error: error.message };
  }

  await supabase.from("events").insert({
    business_id: businessId,
    type: "admin_edit",
    data: { field: "facts", old_value: before?.facts ?? null, new_value: facts },
  });

  return { ok: true };
}

// Deliberately excludes stripe_customer_id / stripe_connect_account_id /
// stripe_connect_status / plan — those are written by webhook handlers
// keyed off them; hand-editing risks desyncing from Stripe's actual state.
export interface SettingsFields {
  name: string;
  owner_name: string | null;
  owner_cell: string | null;
  forward_number: string | null;
  timezone: string;
  deposit_cents: number;
  deposit_label: string | null;
  status: Business["status"];
}

export async function updateBusinessSettings(
  supabase: Supabase,
  businessId: string,
  fields: SettingsFields
): Promise<MutationResult> {
  const { data: before } = await supabase
    .from("businesses")
    .select("name, owner_name, owner_cell, forward_number, timezone, deposit_cents, deposit_label, status")
    .eq("id", businessId)
    .maybeSingle();

  const { error } = await supabase.from("businesses").update(fields).eq("id", businessId);
  if (error) {
    return { ok: false, error: error.message };
  }

  await supabase.from("events").insert({
    business_id: businessId,
    type: "admin_edit",
    data: { field: "settings", old_value: before, new_value: fields },
  });

  return { ok: true };
}
