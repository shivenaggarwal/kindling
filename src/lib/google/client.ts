import { auth, gmail as gmailApi } from "@googleapis/gmail";
import { calendar as calendarApi } from "@googleapis/calendar";
import { env } from "../config";
import { decrypt } from "../crypto";
import type { Mailbox } from "../db/schema";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export const redirectUri = () => `${env.appUrl}/api/google/callback`;

export function oauthClient() {
  if (!env.googleClientId || !env.googleClientSecret) {
    throw new Error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set");
  }
  return new auth.OAuth2(env.googleClientId, env.googleClientSecret, redirectUri());
}

export function authUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  });
}

function authedClient(mailbox: Mailbox) {
  const c = oauthClient();
  c.setCredentials({ refresh_token: decrypt(mailbox.refreshTokenEnc) });
  return c;
}

export function gmailFor(mailbox: Mailbox) {
  return gmailApi({ version: "v1", auth: authedClient(mailbox) });
}

export function calendarFor(mailbox: Mailbox) {
  // Both packages share googleapis-common, so the OAuth2 client is compatible at runtime.
  return calendarApi({ version: "v3", auth: authedClient(mailbox) as never });
}

export const hasCalendar = (mailbox: Mailbox) => mailbox.scopes.includes("calendar.events");
