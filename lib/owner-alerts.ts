import { getTwilioClient } from "@/lib/twilio";
import { env } from "@/lib/env";
import type { Business, Lead } from "@/lib/types";

async function sendToOwner(business: Business, body: string) {
  if (!business.owner_cell) {
    console.error(`Business ${business.id} has no owner_cell; cannot send owner alert.`);
    return;
  }
  const client = getTwilioClient();
  await client.messages.create({
    from: env.TWILIO_NUMBER,
    to: business.owner_cell,
    body,
  });
}

// Sent on booking. See SPEC.md "Owner alerts" for the target format.
export async function sendBookingLiveLine(
  business: Business,
  lead: Lead,
  opts: { bookedLabel: string; depositLine: string; isAiAgent: boolean }
) {
  const header = opts.isAiAgent ? "AI AGENT CALL (Google)\n" : "";
  const score = lead.score ?? 0;
  const urgency = (lead.urgency ?? "").toUpperCase();
  const lines = [
    `${header}NEW LEAD (score ${score})`,
    `${lead.name ?? "Unknown"} • ${lead.phone}`,
    `${lead.address ?? "no address given"}${lead.zip ? ", " + lead.zip : ""}`,
    `${lead.summary ?? lead.job_type ?? "no details given"}${urgency ? " • " + urgency : ""}`,
    `Booked ${opts.bookedLabel}${opts.depositLine ? " • " + opts.depositLine : ""}`,
    `Reply with a number to text them directly.`,
  ];
  await sendToOwner(business, lines.join("\n"));
}

// Sent on escalation.
export async function sendEscalationAlert(
  business: Business,
  lead: Lead,
  opts: { reason: string; lastCustomerMessage: string; isAiAgent: boolean }
) {
  const header = opts.isAiAgent ? "AI AGENT CALL (Google)\n" : "";
  const lines = [
    `${header}ESCALATED: ${opts.reason}`,
    `${lead.name ?? "Unknown"} • ${lead.phone}`,
    `"${opts.lastCustomerMessage}"`,
    `Reply with a number to text them directly.`,
  ];
  await sendToOwner(business, lines.join("\n"));
}
