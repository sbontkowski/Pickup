import twilio from "twilio";
import { env } from "@/lib/env";

export function getTwilioClient() {
  return twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
}

// Reconstructs the exact public URL Twilio signed, from the incoming
// request. Vercel sets x-forwarded-proto/host; local dev falls back to the
// request's own protocol/host.
export function publicUrlFor(request: Request): string {
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  return `${proto}://${host}${url.pathname}`;
}

// Validates the X-Twilio-Signature header against the request URL and
// form params. Every Twilio webhook must call this before doing anything
// else with the payload.
export function isValidTwilioRequest(
  request: Request,
  params: Record<string, string>
): boolean {
  const signature = request.headers.get("x-twilio-signature");
  if (!signature) return false;

  const url = publicUrlFor(request);
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
}

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function formDataToParams(request: Request): Promise<Record<string, string>> {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") params[key] = value;
  }
  return params;
}
