import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { recordUsage } from "../log";
import { AiRefusal, closedJsonSchema, type StructuredOpts, type UsageCtx } from "./common";

export const MODEL = "claude-opus-5-5";

// Pricing for claude-opus-5-5 (USD per token) and server tools, used for cost tracking.
const PRICE = {
  input: 4 / 1e6,
  output: 20 / 1e6,
  cacheWrite: 5 / 1e6,
  cacheRead: 0.2 / 1e6,
  webSearch: 10 / 1000,
};

let _client: Anthropic | null = null;
export function claude() {
  if (!_client) _client = new Anthropic({ maxRetries: 4, timeout: 10 * 60 * 1000 });
  return _client;
}

async function trackUsage(usage: Anthropic.Beta.BetaUsage, ctx: UsageCtx) {
  const input = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const searches = usage.server_tool_use?.web_search_requests ?? 0;
  const cost =
    input * PRICE.input +
    output * PRICE.output +
    cacheWrite * PRICE.cacheWrite +
    cacheRead * PRICE.cacheRead +
    searches * PRICE.webSearch;
  await recordUsage({
    projectId: ctx.projectId,
    segmentId: ctx.segmentId,
    provider: "anthropic",
    operation: ctx.operation,
    units: input + output + cacheWrite + cacheRead,
    costUsd: cost,
    meta: { input, output, cacheWrite, cacheRead, searches },
  });
}

/** JSON Schema that strict tool use accepts: closed objects, validation keywords stripped. */
const toStrictSchema = (schema: z.ZodType) =>
  closedJsonSchema(schema, [
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
    "pattern",
    "format",
    "default",
  ]);


/**
 * Run one structured task: Claude may use web search / web fetch (server-side
 * tools) and must finish by calling a strict `submit` tool whose input is the
 * result. Returns the validated result.
 */
export async function runClaude<T extends z.ZodType>(opts: StructuredOpts<T>): Promise<z.infer<T>> {
  const client = claude();
  const toolName = "submit";

  const tools: Anthropic.Beta.BetaToolUnion[] = [];
  if (opts.webSearch) tools.push({ type: "web_search_20260209", name: "web_search", max_uses: opts.webSearch });
  if (opts.webFetch) tools.push({ type: "web_fetch_20260209", name: "web_fetch", max_uses: opts.webFetch });
  tools.push({
    name: toolName,
    description: opts.submitDescription ?? "Submit your final result. Call this exactly once when you are done.",
    input_schema: toStrictSchema(opts.schema) as Anthropic.Beta.BetaTool.InputSchema,
    strict: true,
  });

  const system: Anthropic.Beta.BetaTextBlockParam[] = [{ type: "text", text: opts.system }];
  if (opts.context) system.push({ type: "text", text: opts.context });
  system[system.length - 1].cache_control = { type: "ephemeral" };

  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: `${opts.prompt}\n\nWhen you're done, call the \`${toolName}\` tool with your result.` },
  ];

  for (let turn = 0; turn < 8; turn++) {
    const stream = client.beta.messages.stream({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: opts.effort ?? "medium" },
      system,
      tools,
      tool_choice: { type: "auto" },
      messages,
    });
    const msg = await stream.finalMessage();
    await trackUsage(msg.usage, opts.usage);

    if (msg.stop_reason === "refusal") {
      throw new AiRefusal(msg.stop_details?.explanation ?? "Claude declined this request");
    }

    const submit = msg.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === toolName,
    );

    if (submit && msg.stop_reason !== "max_tokens") {
      const parsed = opts.schema.safeParse(submit.input);
      if (parsed.success) return parsed.data;
      messages.push({ role: "assistant", content: msg.content });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: submit.id,
            is_error: true,
            content: `The input didn't validate: ${parsed.error.message.slice(0, 2000)}. Call ${toolName} again with corrected input.`,
          },
        ],
      });
      continue;
    }

    if (msg.stop_reason === "max_tokens") {
      throw new Error(`Claude ran out of output tokens during ${opts.usage.operation}`);
    }

    // Server tool hit its per-turn iteration limit: send the turn back so it continues.
    if (msg.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: msg.content });
      continue;
    }

    // Finished without submitting: nudge it to submit.
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: `Call the \`${toolName}\` tool now with your final result.` });
  }
  throw new Error(`Claude didn't return a result for ${opts.usage.operation}`);
}
