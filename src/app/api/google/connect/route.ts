import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { authUrl } from "@/lib/google/client";

export async function GET() {
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("kindling_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 600,
  });
  return Response.redirect(authUrl(state), 302);
}
