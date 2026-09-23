import { DateTime } from "luxon";
import { getSupabaseAdmin } from "@/lib/supabase";

export const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

export interface OpenWindow {
  startsAt: string; // ISO UTC
  endsAt: string; // ISO UTC
  label: string; // e.g. "Tue 9/23 8-10 AM", in business-local time
}

const LOOKAHEAD_DAYS = 14;
const MAX_RESULTS = 6;

// Returns the next open windows from `availability`, minus what's already
// held/confirmed in `appointments`, in the business's own timezone.
export async function getOpenWindows(
  businessId: string,
  timezone: string
): Promise<OpenWindow[]> {
  const supabase = getSupabaseAdmin();

  const { data: availabilityRows, error: availError } = await supabase
    .from("availability")
    .select("*")
    .eq("business_id", businessId);

  if (availError) throw new Error(`Failed to load availability: ${availError.message}`);
  if (!availabilityRows || availabilityRows.length === 0) return [];

  const now = DateTime.now().setZone(timezone);
  const horizonEnd = now.plus({ days: LOOKAHEAD_DAYS });

  const { data: appointments, error: apptError } = await supabase
    .from("appointments")
    .select("starts_at, ends_at")
    .eq("business_id", businessId)
    .in("status", ["held", "confirmed"])
    .gte("starts_at", now.toUTC().toISO())
    .lte("starts_at", horizonEnd.toUTC().toISO());

  if (apptError) throw new Error(`Failed to load appointments: ${apptError.message}`);

  // Count how many appointments already occupy each availability row's
  // exact window (start+end), keyed by ISO start.
  const bookedCountByStart = new Map<string, number>();
  for (const appt of appointments ?? []) {
    const key = new Date(appt.starts_at).toISOString();
    bookedCountByStart.set(key, (bookedCountByStart.get(key) ?? 0) + 1);
  }

  const candidates: OpenWindow[] = [];

  for (let dayOffset = 0; dayOffset < LOOKAHEAD_DAYS; dayOffset++) {
    const day = now.plus({ days: dayOffset }).startOf("day");
    const weekday = day.weekday % 7; // luxon: Mon=1..Sun=7 -> our 0=Sun..6=Sat

    for (const row of availabilityRows) {
      if (row.weekday !== weekday) continue;

      const [startHour, startMinute] = row.start_time.split(":").map(Number);
      const [endHour, endMinute] = row.end_time.split(":").map(Number);

      const windowStart = day.set({ hour: startHour, minute: startMinute, second: 0 });
      const windowEnd = day.set({ hour: endHour, minute: endMinute, second: 0 });

      if (windowStart < now) continue;

      const startIso = windowStart.toUTC().toISO()!;
      const bookedCount = bookedCountByStart.get(new Date(startIso).toISOString()) ?? 0;
      if (bookedCount >= row.slots_per_window) continue;

      candidates.push({
        startsAt: startIso,
        endsAt: windowEnd.toUTC().toISO()!,
        label: formatWindowLabel(windowStart, windowEnd),
      });
    }
  }

  candidates.sort((a, b) => (a.startsAt < b.startsAt ? -1 : 1));
  return candidates.slice(0, MAX_RESULTS);
}

function formatWindowLabel(start: DateTime, end: DateTime): string {
  const day = start.toFormat("ccc M/d");
  const startLabel = start.toFormat("h a");
  const endLabel = end.toFormat("h a");
  return `${day} ${startLabel}-${endLabel}`;
}
