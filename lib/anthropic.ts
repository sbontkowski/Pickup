import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/lib/env";

// Model and settings are pinned per SPEC.md "Conversational agent spec":
// claude-sonnet-4-5, max_tokens 400, temperature 0.3, last 30 messages.
// SPEC.md says "up to 4 tool-call iterations per turn", but only plain-text
// history is replayed between turns (no tool_use/tool_result memory), so a
// booking turn can realistically need get_availability + score_lead +
// book_slot + send_payment_link before any final confirmation text — that's
// 4 tool calls with zero budget left to actually reply. Raised to 6 so the
// worst-case real chain always has room for the closing text.
export const AGENT_MODEL = "claude-sonnet-4-5";
export const AGENT_MAX_TOKENS = 400;
export const AGENT_TEMPERATURE = 0.3;
export const AGENT_MAX_TOOL_ITERATIONS = 6;

export function getAnthropicClient() {
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

export interface ToolLoopResult {
  text: string;
  hitIterationCap: boolean;
}

// Shared "one call per inbound text, loop on tool calls" agent mechanics —
// used by both the customer-facing agent and the owner's ask-your-desk
// agent. Returns the final assistant text, or hitIterationCap=true if the
// model was still trying to call tools when the budget ran out (the caller
// decides the fallback behavior for that case).
export async function runToolLoop(params: {
  system: string;
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  executeTool: (name: string, input: Record<string, unknown>) => Promise<{ content: string; isError?: boolean }>;
  maxTokens?: number;
  temperature?: number;
}): Promise<ToolLoopResult> {
  const client = getAnthropicClient();
  const messages = [...params.messages];

  for (let iteration = 0; iteration < AGENT_MAX_TOOL_ITERATIONS; iteration++) {
    const response = await client.messages.create({
      model: AGENT_MODEL,
      max_tokens: params.maxTokens ?? AGENT_MAX_TOKENS,
      temperature: params.temperature ?? AGENT_TEMPERATURE,
      system: params.system,
      tools: params.tools,
      messages,
    });

    if (response.stop_reason === "max_tokens") {
      // The response (text and/or a tool call) was cut off mid-generation —
      // never treat this as a normal, complete reply.
      console.warn(`runToolLoop hit max_tokens (limit=${params.maxTokens ?? AGENT_MAX_TOKENS}) on iteration ${iteration}.`);
      return { text: "", hitIterationCap: true };
    }

    if (response.stop_reason !== "tool_use") {
      return { text: extractText(response.content), hitIterationCap: false };
    }

    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUseBlocks) {
      const result = await params.executeTool(toolUse.name, toolUse.input as Record<string, unknown>);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: result.content,
        is_error: result.isError,
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  return { text: "", hitIterationCap: true };
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join(" ")
    .trim();
}
