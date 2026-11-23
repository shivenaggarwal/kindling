import { z } from "zod";

export type UsageCtx = { projectId?: string | null; segmentId?: string | null; operation: string };

/** One structured task, provider-agnostic. Each provider turns this into its own API call. */
export type StructuredOpts<T extends z.ZodType> = {
  system: string;
  /** Stable per-project context placed after the system prompt (cached where the provider supports it). */
  context?: string;
  prompt: string;
  schema: T;
  submitDescription?: string;
  webSearch?: number; // max searches (Claude) / enables Google Search grounding (Gemini)
  webFetch?: number; // max fetches (Claude) / enables URL context (Gemini)
  effort?: "low" | "medium" | "high" | "xhigh";
  maxTokens?: number;
  usage: UsageCtx;
};

/** The model declined the request. Retrying won't help. */
export class AiRefusal extends Error {}

/**
 * Zod schema → JSON Schema with every object closed and all keys required
 * (the app's schemas use `.nullable()` rather than optional keys), minus the
 * keywords in `drop`.
 */
export function closedJsonSchema(schema: z.ZodType, drop: string[]): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: "draft-2020-12", unrepresentable: "any" }) as Record<string, unknown>;
  const DROP = new Set(["$schema", ...drop]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (DROP.has(k)) continue;
      out[k] = walk(v);
    }
    if (out.type === "object" && out.properties && typeof out.properties === "object") {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as object);
    }
    return out;
  };
  return walk(json) as Record<string, unknown>;
}
