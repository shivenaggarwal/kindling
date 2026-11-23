/** Product name lives here so renaming the product is a one-line change. */
export const APP_NAME = "Kindling";
export const APP_TAGLINE = "Turns cold markets into warm leads";

const num = (v: string | undefined, d: number) => (v && !Number.isNaN(Number(v)) ? Number(v) : d);

export const env = {
  appUrl: (
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000")
  ).replace(/\/$/, ""),
  appPassword: process.env.APP_PASSWORD ?? "",
  appSecret: process.env.APP_SECRET ?? "",
  apolloKey: process.env.APOLLO_API_KEY ?? "",
  instantlyKey: process.env.INSTANTLY_API_KEY ?? "",
  hunterKey: process.env.HUNTER_API_KEY ?? "",
  placesKey: process.env.GOOGLE_PLACES_API_KEY ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  cost: {
    apolloCredit: num(process.env.COST_APOLLO_CREDIT, 0.025),
    hunterRequest: num(process.env.COST_HUNTER_REQUEST, 0.0165),
    placesRequest: num(process.env.COST_PLACES_REQUEST, 0.035),
  },
};

const hasAnthropic = () => Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const hasGemini = () => Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);

/** Which model provider runs the agent: AI_PROVIDER if set, else whichever key is present (Claude first). */
export function aiProvider(): "anthropic" | "gemini" {
  const pick = (process.env.AI_PROVIDER ?? "").toLowerCase();
  if (pick === "gemini" || pick === "google") return "gemini";
  if (pick === "anthropic" || pick === "claude") return "anthropic";
  if (hasAnthropic()) return "anthropic";
  return hasGemini() ? "gemini" : "anthropic";
}

export const integrations = () => ({
  /** The configured AI provider has a key, so the agent can run. */
  ai: aiProvider() === "gemini" ? hasGemini() : hasAnthropic(),
  aiProvider: aiProvider(),
  anthropic: hasAnthropic(),
  gemini: hasGemini(),
  apollo: Boolean(env.apolloKey),
  hunter: Boolean(env.hunterKey),
  places: Boolean(env.placesKey),
  instantly: Boolean(env.instantlyKey),
  google: Boolean(env.googleClientId && env.googleClientSecret),
});

import type { ProjectSettings } from "./types";

/** Which delivery path a project uses. */
export const sendVia = (s: ProjectSettings): "instantly" | "gmail" =>
  s.sendVia ?? (env.instantlyKey ? "instantly" : "gmail");
