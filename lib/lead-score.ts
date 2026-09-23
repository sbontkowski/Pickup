// Lead scoring is computed here, in code, from fixed weights — never by the
// model. See SPEC.md "Conversational agent spec" -> "Lead score".
import { DateTime } from "luxon";

export type Urgency = "emergency" | "soon" | "flexible";
export type JobType = "replacement" | "repair" | "maintenance" | string;

const URGENCY_WEIGHT: Record<Urgency, number> = {
  emergency: 40,
  soon: 25,
  flexible: 10,
};

const JOB_TYPE_WEIGHT: Record<string, number> = {
  replacement: 40,
  repair: 25,
  maintenance: 10,
};

export function isInServiceArea(zip: string | null | undefined, facts: Record<string, unknown>): boolean {
  const zips = facts.service_area_zips;
  if (!zip || !Array.isArray(zips)) return false;
  return zips.includes(zip);
}

export function isAfterHoursOrWeekend(timezone: string, at: Date = new Date()): boolean {
  const local = DateTime.fromJSDate(at, { zone: timezone });
  const isWeekend = local.weekday === 6 || local.weekday === 7; // Sat=6, Sun=7
  const isAfterHours = local.hour < 8 || local.hour >= 18;
  return isWeekend || isAfterHours;
}

export function computeLeadScore(input: {
  urgency: Urgency;
  jobType: JobType;
  zip: string | null | undefined;
  facts: Record<string, unknown>;
  timezone: string;
  at?: Date;
}): number {
  let score = 0;
  score += URGENCY_WEIGHT[input.urgency] ?? 0;
  score += JOB_TYPE_WEIGHT[input.jobType.toLowerCase()] ?? 0;
  if (isAfterHoursOrWeekend(input.timezone, input.at)) score += 10;
  if (isInServiceArea(input.zip, input.facts)) score += 10;
  return Math.min(100, score);
}

// Estimated value from the facts' price ranges (midpoint); replacement
// defaults to $9,500 if the facts give none. Never invents a price outside
// what's in facts.price_ranges.
export function computeEstValueCents(jobType: JobType, facts: Record<string, unknown>): number {
  const priceRanges = (facts.price_ranges ?? {}) as Record<string, string>;
  const key = jobType.toLowerCase();
  const rangeKey =
    key === "replacement" ? "replacement" : key === "maintenance" ? "maintenance" : "common_repair";
  const range = priceRanges[rangeKey];

  if (range) {
    const numbers = range.match(/[\d,]+/g)?.map((n) => Number(n.replace(/,/g, "")));
    if (numbers && numbers.length >= 2) {
      return Math.round(((numbers[0] + numbers[1]) / 2) * 100);
    }
    if (numbers && numbers.length === 1) {
      return Math.round(numbers[0] * 100);
    }
  }

  return key === "replacement" ? 950000 : 0;
}
