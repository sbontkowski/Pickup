import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// Model and settings are pinned per SPEC.md "Conversational agent spec":
// claude-sonnet-4-5, max_tokens 400, temperature 0.3, last 30 messages,
// up to 4 tool-call iterations per turn.
export const AGENT_MODEL = "claude-sonnet-4-5";
export const AGENT_MAX_TOKENS = 400;
export const AGENT_TEMPERATURE = 0.3;
export const AGENT_MAX_TOOL_ITERATIONS = 4;

export function getAnthropicClient() {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}
