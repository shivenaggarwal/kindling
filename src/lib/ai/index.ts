import type { z } from "zod";
import { aiProvider } from "../config";
import { runClaude } from "./claude";
import { runGemini } from "./gemini";
import type { StructuredOpts } from "./common";

export { AiRefusal } from "./common";

/**
 * Run one structured task on whichever model provider is configured
 * (AI_PROVIDER, otherwise whichever key is present). The model may research
 * the web, and the result is validated against `schema`.
 */
export function runStructured<T extends z.ZodType>(opts: StructuredOpts<T>): Promise<z.infer<T>> {
  return aiProvider() === "gemini" ? runGemini(opts) : runClaude(opts);
}
