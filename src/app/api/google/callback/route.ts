import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { env } from "@/lib/config";
import { db, schema } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { oauthClient } from "@/lib/google/client";

function back(params: Record<string, string>) {
  return Response.redirect(`${env.appUrl}/settings?${new URLSearchParams(params)}`, 302);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const jar = await cookies();
  const expected = jar.get("kindling_oauth_state")?.value;
  jar.delete("kindling_oauth_state");

  if (url.searchParams.get("error")) return back({ error: url.searchParams.get("error")! });
  const code = url.searchParams.get("code");
  if (!code || !expected || url.searchParams.get("state") !== expected) return back({ error: "invalid state, please try again" });

  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token) return back({ error: "Google didn't return an identity token" });
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: env.googleClientId });
    const payload = ticket.getPayload();
    const email = payload?.email?.toLowerCase();
    if (!email) return back({ error: "couldn't read the account email" });

    const scopes = tokens.scope ?? "";
    if (!scopes.includes("gmail.send") || !scopes.includes("gmail.readonly")) {
      return back({ error: "Gmail permissions weren't granted. Tick every box on Google's consent screen." });
    }

    const values = {
      email,
      displayName: payload?.name ?? null,
      scopes,
      active: true,
      lastError: null,
      ...(tokens.refresh_token ? { refreshTokenEnc: encrypt(tokens.refresh_token) } : {}),
    };

    if (tokens.refresh_token) {
      await db
        .insert(schema.mailboxes)
        .values({ ...values, refreshTokenEnc: encrypt(tokens.refresh_token) })
        .onConflictDoUpdate({ target: schema.mailboxes.email, set: values });
    } else {
      // Google only returns a refresh token on first consent; keep the stored one.
      const updated = await db
        .update(schema.mailboxes)
        .set(values)
        .where(eq(schema.mailboxes.email, email))
        .returning({ id: schema.mailboxes.id });
      if (!updated.length) return back({ error: "no refresh token returned; remove the app at myaccount.google.com/permissions and reconnect" });
    }
    return back({ connected: email });
  } catch (e) {
    return back({ error: e instanceof Error ? e.message : "unknown error" });
  }
}
