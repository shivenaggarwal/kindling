import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

/** Everything except the login page requires a session. */
export async function proxy(request: NextRequest) {
  const ok = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL("/login", request.url);
  url.searchParams.set("next", request.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|api/cron|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
