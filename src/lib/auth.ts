import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "kindling_session";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function secretKey() {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 16) throw new Error("APP_SECRET must be set (32+ random characters)");
  return new TextEncoder().encode(`kindling:session:${s}`);
}

export async function createSessionToken() {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined) {
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return true;
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: MAX_AGE,
};
