import { isIP } from "node:net";

const UA = "Mozilla/5.0 (compatible; KindlingBot/1.0; +https://example.com/bot)";

/** Normalise "https://www.Acme.com/about?x" → "acme.com". Returns null if it doesn't look like a domain. */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (!s) return null;
  if (s.includes("@")) s = s.split("@").pop()!;
  try {
    const url = new URL(s.includes("://") ? s : `https://${s}`);
    s = url.hostname;
  } catch {
    return null;
  }
  s = s.replace(/^www\./, "").replace(/\.$/, "");
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s)) return null;
  return s;
}

function isPrivateHost(host: string): boolean {
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (isIP(host)) {
    return (
      /^(10\.|127\.|0\.|169\.254\.|192\.168\.)/.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "::1" ||
      host.startsWith("fc") ||
      host.startsWith("fd")
    );
  }
  return false;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

export type FetchedPage = { url: string; title: string; description: string; text: string; links: string[] };

export async function fetchPage(url: string, maxChars = 8000): Promise<FetchedPage | null> {
  try {
    const u = new URL(url);
    if (!["http:", "https:"].includes(u.protocol) || isPrivateHost(u.hostname)) return null;
    const res = await fetch(u, {
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
    const html = (await res.text()).slice(0, 1_500_000);
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "";
    const description =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
      "";
    const base = new URL(res.url || url);
    const links = Array.from(html.matchAll(/<a[^>]+href=["']([^"'#]+)["']/gi))
      .map((m) => {
        try {
          return new URL(m[1], base).toString();
        } catch {
          return null;
        }
      })
      .filter((l): l is string => !!l && new URL(l).hostname === base.hostname);
    return {
      url: res.url || url,
      title: htmlToText(title),
      description: htmlToText(description),
      text: htmlToText(html).slice(0, maxChars),
      links: Array.from(new Set(links)),
    };
  } catch {
    return null;
  }
}

/** Homepage plus a few high-signal internal pages (about, pricing, products…). */
export async function crawlSite(domain: string, maxPages = 4): Promise<FetchedPage[]> {
  const home = (await fetchPage(`https://${domain}`)) ?? (await fetchPage(`https://www.${domain}`));
  if (!home) return [];
  const wanted = /(about|pricing|price|product|service|solution|customer|case|wholesale|industr|who-we|team)/i;
  const picks = home.links
    .filter((l) => wanted.test(new URL(l).pathname))
    .sort((a, b) => a.length - b.length)
    .slice(0, maxPages - 1);
  const rest = await Promise.all(picks.map((l) => fetchPage(l, 4000)));
  return [home, ...rest.filter((p): p is FetchedPage => !!p)];
}
