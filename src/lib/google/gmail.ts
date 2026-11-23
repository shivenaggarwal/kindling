import type { gmail_v1 } from "@googleapis/gmail";
import type { Mailbox } from "../db/schema";
import { htmlToText } from "../sources/site";
import { gmailFor } from "./client";

const clean = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function encodeHeader(value: string) {
  const v = clean(value);
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

function formatAddress(name: string | null | undefined, email: string) {
  return name ? `${encodeHeader(`"${name.replace(/"/g, "")}"`)} <${clean(email)}>` : clean(email);
}

export type OutgoingMail = {
  to: string;
  fromName?: string | null;
  subject: string;
  body: string;
  threadId?: string | null;
  inReplyTo?: string | null; // RFC Message-ID of the message we're replying to
};

export async function sendMail(mailbox: Mailbox, mail: OutgoingMail) {
  const g = gmailFor(mailbox);
  const headers = [
    `From: ${formatAddress(mail.fromName ?? mailbox.displayName, mailbox.email)}`,
    `To: ${clean(mail.to)}`,
    `Subject: ${encodeHeader(mail.subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    `List-Unsubscribe: <mailto:${mailbox.email}?subject=unsubscribe>`,
  ];
  if (mail.inReplyTo) {
    headers.push(`In-Reply-To: ${clean(mail.inReplyTo)}`, `References: ${clean(mail.inReplyTo)}`);
  }
  const bodyB64 = Buffer.from(mail.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/(.{76})/g, "$1\r\n");
  const raw = Buffer.from(`${headers.join("\r\n")}\r\n\r\n${bodyB64}`, "utf8").toString("base64url");

  const sent = await g.users.messages.send({
    userId: "me",
    requestBody: { raw, ...(mail.threadId ? { threadId: mail.threadId } : {}) },
  });
  const id = sent.data.id!;
  const threadId = sent.data.threadId!;
  // Gmail assigns the RFC Message-ID; read it back so follow-ups can thread properly.
  const meta = await g.users.messages.get({ userId: "me", id, format: "metadata", metadataHeaders: ["Message-ID"] });
  const rfcMessageId = header(meta.data.payload, "Message-ID");
  return { id, threadId, rfcMessageId };
}

function header(payload: gmail_v1.Schema$MessagePart | undefined, name: string) {
  return payload?.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())?.value ?? null;
}

function decode(data?: string | null) {
  return data ? Buffer.from(data, "base64url").toString("utf8") : "";
}

function extractText(part: gmail_v1.Schema$MessagePart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  const kids = part.parts ?? [];
  const plain = kids.map(extractText).find((t) => t.trim());
  if (plain) return plain;
  if (part.mimeType === "text/html" && part.body?.data) return htmlToText(decode(part.body.data));
  return "";
}

/** Drop the quoted history below a reply. */
export function stripQuoted(text: string) {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^On .+wrote:\s*$/.test(line.trim())) break;
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^From: .+/.test(line.trim()) && out.length > 0) break;
    if (/^Le .+a écrit\s*:/.test(line.trim()) || /^Am .+schrieb.+:/.test(line.trim())) break;
    if (line.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

export type IncomingMail = {
  id: string;
  threadId: string;
  from: string;
  fromEmail: string;
  to: string;
  subject: string;
  date: Date;
  text: string;
  rfcMessageId: string | null;
  labelIds: string[];
};

export async function getMail(mailbox: Mailbox, id: string): Promise<IncomingMail> {
  const g = gmailFor(mailbox);
  const { data } = await g.users.messages.get({ userId: "me", id, format: "full" });
  const from = header(data.payload, "From") ?? "";
  const fromEmail = (from.match(/<([^>]+)>/)?.[1] ?? from).trim().toLowerCase();
  return {
    id: data.id!,
    threadId: data.threadId!,
    from,
    fromEmail,
    to: header(data.payload, "To") ?? "",
    subject: header(data.payload, "Subject") ?? "",
    date: new Date(Number(data.internalDate ?? Date.now())),
    text: stripQuoted(extractText(data.payload)).slice(0, 8000),
    rfcMessageId: header(data.payload, "Message-ID"),
    labelIds: data.labelIds ?? [],
  };
}

/** Recent messages not sent by this mailbox (ids + thread ids only). */
export async function listRecentIncoming(mailbox: Mailbox, days = 14) {
  const g = gmailFor(mailbox);
  const out: { id: string; threadId: string }[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 5; page++) {
    const { data } = await g.users.messages.list({
      userId: "me",
      q: `newer_than:${days}d -from:me -in:chats`,
      maxResults: 100,
      pageToken,
    });
    for (const m of data.messages ?? []) if (m.id && m.threadId) out.push({ id: m.id, threadId: m.threadId });
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return out;
}
