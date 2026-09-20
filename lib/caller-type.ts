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
