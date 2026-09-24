"use server";

import { redirect } from "next/navigation";
import { createLoginToken } from "@/lib/admin/auth";
import { getTwilioClient } from "@/lib/twilio";
import { env } from "@/lib/env";

// Best-effort, per-instance cooldown — there's a single admin, so this only
// needs to stop a bored/automated visitor from spamming Steven's phone, not
// survive a cold start.
let lastRequestAt = 0;
const COOLDOWN_MS = 60 * 1000;

export async function requestLoginLink() {
  const now = Date.now();
  if (now - lastRequestAt >= COOLDOWN_MS) {
    lastRequestAt = now;
    const token = await createLoginToken();
    const url = `${env.APP_BASE_URL}/admin/verify?token=${encodeURIComponent(token)}`;

    try {
      const client = getTwilioClient();
      await client.messages.create({
        from: env.TWILIO_NUMBER,
        to: env.SUPPORT_CELL,
        body: `Pickup admin login (expires in 10 min): ${url}`,
      });
    } catch (err) {
      console.error("Failed to send admin login SMS:", err instanceof Error ? err.message : err);
      redirect("/admin/login?error=1");
    }
  }

  redirect("/admin/login?sent=1");
}
