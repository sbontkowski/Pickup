// Detects Google's agentic-calling caller ID range from GOOGLE_AGENT_CALLER_IDS
// (comma-separated numbers or prefixes, e.g. "+1650253,+1866"). Left blank
// until the real range is confirmed in Google Business Profile Help
// (see SPEC.md "Open questions").
export function isGoogleAgentCallerId(fromNumber: string): boolean {
  const raw = process.env.GOOGLE_AGENT_CALLER_IDS;
  if (!raw) return false;
  return raw
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
    .some((prefix) => fromNumber.startsWith(prefix));
}

// A text-based fallback for automated callers when the caller ID range
// doesn't match: "on behalf of" plus "automated" or "assistant".
export function looksLikeAutomatedAgentText(body: string): boolean {
  const lower = body.toLowerCase();
  return lower.includes("on behalf of") && (lower.includes("automated") || lower.includes("assistant"));
}
