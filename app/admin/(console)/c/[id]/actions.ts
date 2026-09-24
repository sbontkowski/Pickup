"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSupabaseAdmin } from "@/lib/supabase";
import { updateBusinessFacts, updateBusinessSettings, type SettingsFields } from "@/lib/admin/business-mutations";
import type { Business } from "@/lib/types";

export async function updateFactsAction(businessId: string, formData: FormData) {
  const supabase = getSupabaseAdmin();
  const rawFacts = String(formData.get("facts") ?? "");
  const result = await updateBusinessFacts(supabase, businessId, rawFacts);

  const tabUrl = `/admin/c/${businessId}?tab=facts`;
  if (!result.ok) {
    redirect(`${tabUrl}&error=${encodeURIComponent(result.error ?? "Save failed")}`);
  }
  revalidatePath(`/admin/c/${businessId}`);
  redirect(`${tabUrl}&saved=1`);
}

export async function updateSettingsAction(businessId: string, formData: FormData) {
  const supabase = getSupabaseAdmin();

  const depositCentsRaw = String(formData.get("deposit_cents") ?? "0");
  const depositCents = Number.parseInt(depositCentsRaw, 10);

  const fields: SettingsFields = {
    name: String(formData.get("name") ?? ""),
    owner_name: (formData.get("owner_name") as string) || null,
    owner_cell: (formData.get("owner_cell") as string) || null,
    forward_number: (formData.get("forward_number") as string) || null,
    timezone: String(formData.get("timezone") ?? "America/New_York"),
    deposit_cents: Number.isFinite(depositCents) && depositCents >= 0 ? depositCents : 0,
    deposit_label: (formData.get("deposit_label") as string) || null,
    status: (formData.get("status") as Business["status"]) ?? "trial",
  };

  const tabUrl = `/admin/c/${businessId}?tab=settings`;
  const result = await updateBusinessSettings(supabase, businessId, fields);
  if (!result.ok) {
    redirect(`${tabUrl}&error=${encodeURIComponent(result.error ?? "Save failed")}`);
  }
  revalidatePath(`/admin/c/${businessId}`);
  redirect(`${tabUrl}&saved=1`);
}
