import { ApiError, GoogleGenAI, ThinkingLevel, type Content, type GenerateContentResponse, type Tool } from "@google/genai";
import { z } from "zod";
import { recordUsage } from "../log";
import { AiRefusal, closedJsonSchema, type StructuredOpts, type UsageCtx } from "./common";

/**
 * Gemini provider. Works with both kinds of Google key:
 *  - Gemini API keys from AI Studio ("AIza…")
 *  - Vertex AI express-mode keys ("AQ.…"), which go to aiplatform.googleapis.com
 * Web research uses Google Search grounding + URL context, and the answer is
 * constrained to the task's JSON schema.
 */

const apiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

/** Primary model first, then fallbacks used when a model is overloaded (429/5xx). */
export function geminiModels() {
  const list = [
    process.env.GEMINI_MODEL || "gemini-3.8-flash",
    ...(process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3.1-pro-preview").split(","),
  ]
    .map((m) => m.trim())
    .filter(Boolean);
  return [...new Set(list)];
}

// USD per token, standard (non-promotional) list prices so cost per lead never under-reports.
const PRICES: Record<string, { input: number; output: number; cached: number }> = {
  "gemini-3.8-flash": { input: 1.5 / 1e6, output: 7.5 / 1e6, cached: 0.15 / 1e6 },
  "gemini-3.1-pro-preview": { input: 2 / 1e6, output: 12 / 1e6, cached: 0.2 / 1e6 },
  "gemini-4-argon": { input: 4 / 1e6, output: 20 / 1e6, cached: 0.2 / 1e6 },
};
const FALLBACK_PRICE = { input: 4 / 1e6, output: 20 / 1e6, cached: 0.4 / 1e6 };
const SEARCH_PRICE = 14 / 1000; // per grounded search query (after the monthly free allowance)

const LEVEL: Record<NonNullable<StructuredOpts<z.ZodType>["effort"]>, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
  xhigh: ThinkingLevel.HIGH,
};

const BLOCKED = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

let _client: GoogleGenAI | null = null;
function client() {
  const key = apiKey();
  if (!key) throw new Error("No Gemini API key. Add GEMINI_API_KEY to the environment.");
  if (!_client) {
    const vertex = process.env.GEMINI_VERTEX ? process.env.GEMINI_VERTEX === "1" : key.startsWith("AQ.");
    _client = new GoogleGenAI(vertex ? { vertexai: true, apiKey: key } : { apiKey: key });
  }
  return _client;
}

/** Gemini's schema subset: nullable unions become `type: [t, "null"]`, unenforced keywords dropped. */
function geminiSchema(schema: z.ZodType) {
  const base = closedJsonSchema(schema, ["minLength", "maxLength", "pattern", "format", "default", "exclusiveMinimum", "exclusiveMaximum"]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== "object") return node;
    const n = node as Record<string, unknown>;
    const any = n.anyOf as Record<string, unknown>[] | undefined;
    if (Array.isArray(any) && any.length === 2 && any.some((x) => x.type === "null")) {
      const other = any.find((x) => x.type !== "null")!;
      if (typeof other.type === "string") {
        const { anyOf: _drop, ...rest } = n; // eslint-disable-line @typescript-eslint/no-unused-vars
        return walk({ ...rest, ...other, type: [other.type, "null"] });
      }
    }
    return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, walk(v)]));
  };
  return walk(base);
}

async function trackUsage(res: GenerateContentResponse, model: string, ctx: UsageCtx) {
  const u = res.usageMetadata ?? {};
  const cached = u.cachedContentTokenCount ?? 0;
  const input = Math.max(0, (u.promptTokenCount ?? 0) - cached) + (u.toolUsePromptTokenCount ?? 0);
  const output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const searches = res.candidates?.[0]?.groundingMetadata?.webSearchQueries?.length ?? 0;
  const p = PRICES[model] ?? FALLBACK_PRICE;
  await recordUsage({
    projectId: ctx.projectId,
    segmentId: ctx.segmentId,
    provider: "gemini",
    operation: ctx.operation,
    units: input + output + cached,
    costUsd: input * p.input + output * p.output + cached * p.cached + searches * SEARCH_PRICE,
    meta: { model, input, output, cached, searches },
  });
}

function answerText(res: GenerateContentResponse) {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join("")
    .trim();
  // Constrained decoding returns bare JSON, but tolerate a fenced block just in case.
  return text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STYLE =
  "Write every text field as plain prose for a human reader. Never add citation markers, source labels or bracketed references such as [site_content], [source] or [1].";

// Grounded answers sometimes carry source tags into the text anyway; strip them.
const CITATION = /\s*\[(?:[a-z]+_(?:content|data)|sources?|cite[^\]]*|citation[^\]]*|\d+(?:\s*,\s*\d+)*)\]/gi;
function clean(v: unknown): unknown {
  if (typeof v === "string") return v.replace(CITATION, "").trim();
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x)]));
  return v;
}

export async function runGemini<T extends z.ZodType>(opts: StructuredOpts<T>): Promise<z.infer<T>> {
  const models = geminiModels();
  const tools: Tool[] = [];
  if (opts.webSearch) tools.push({ googleSearch: {} });
  if (opts.webFetch) tools.push({ urlContext: {} });

  const systemInstruction = [opts.system, opts.context, STYLE].filter(Boolean).join("\n\n");
  const contents: Content[] = [
    {
      role: "user",
      parts: [{ text: `${opts.prompt}\n\nWhen you're done, answer with only the JSON object described by the response schema.` }],
    },
  ];
  const responseJsonSchema = geminiSchema(opts.schema);

  let m = 0;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 7; attempt++) {
    const model = models[m];
    let res: GenerateContentResponse;
    try {
      res = await client().models.generateContent({
        model,
        contents,
        config: {
          systemInstruction,
          tools: tools.length ? tools : undefined,
          responseMimeType: "application/json",
          responseJsonSchema,
          thinkingConfig: { thinkingLevel: LEVEL[opts.effort ?? "medium"] },
          maxOutputTokens: opts.maxTokens ?? 32000,
          httpOptions: { timeout: 280_000 },
        },
      });
    } catch (e) {
      if (e instanceof ApiError && RETRYABLE.has(e.status)) {
        lastError = e;
        // Overloaded: move to the next model straight away; once out of models, back off and retry.
        if (m < models.length - 1) m++;
        else await sleep(Math.min(30_000, 2 ** attempt * 1500));
        continue;
      }
      throw e;
    }
    await trackUsage(res, model, opts.usage);

    const block = res.promptFeedback?.blockReason;
    const cand = res.candidates?.[0];
    const finish = cand?.finishReason ?? "";
    if (block || BLOCKED.has(finish)) {
      throw new AiRefusal(`Gemini declined this request (${block ?? finish})`);
    }
    if (finish === "MAX_TOKENS") throw new Error(`Gemini ran out of output tokens during ${opts.usage.operation}`);

    const text = answerText(res);
    let problem: string;
    try {
      const parsed = opts.schema.safeParse(clean(JSON.parse(text)));
      if (parsed.success) return parsed.data;
      problem = parsed.error.message.slice(0, 2000);
    } catch {
      problem = text ? "it wasn't valid JSON" : "it was empty";
    }
    lastError = new Error(`Gemini returned invalid output for ${opts.usage.operation}: ${problem.slice(0, 300)}`);
    if (cand?.content?.parts?.length) contents.push({ role: "model", parts: cand.content.parts });
    contents.push({ role: "user", parts: [{ text: `That answer didn't validate: ${problem}. Reply again with the corrected JSON only.` }] });
  }
  throw lastError ?? new Error(`Gemini didn't return a result for ${opts.usage.operation}`);
}
