import { NextResponse } from "next/server";
import { auth } from "@/auth";

// Deliberately named middleware.ts, not proxy.ts (Next.js 16's renamed
// convention) — Netlify's Next.js Runtime (OpenNext-based) doesn't yet
// support proxy.ts at all as of this writing (confirmed via a real deploy:
// every page 500'd with "nextHandler is not a function", and the same
// failure is a known open issue against the adapter). middleware.ts is
// deprecated but still fully functional, so this trades a build-time
// deprecation notice for an actually-working deployment. Revisit once
// Netlify's adapter adds proxy.ts support.
const AUTH_ROUTES = new Set(["/login", "/signup", "/reset-password"]);

export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = Boolean(req.auth?.user);

  const isAuthRoute = AUTH_ROUTES.has(pathname) || pathname.startsWith("/reset-password/");
  const isAppRoute = pathname.startsWith("/home") || pathname.startsWith("/settings");

  if (isAppRoute && !isAuthed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (isAuthRoute && isAuthed) {
    return NextResponse.redirect(new URL("/home", req.url));
  }
});

export const config = {
  // Skip static assets and Next internals; everything else (including API
  // routes) still goes through so /api/auth/* keeps working.
  // Unlike proxy.ts, middleware.ts does NOT default to the Node.js runtime —
  // that only became the automatic default in the proxy.ts rename (Next 16).
  // Node.js middleware itself has been stable since 15.5, just opt-in here,
  // and it's required: the jwt callback in src/auth.ts hits Postgres via the
  // pg driver adapter, which doesn't work on the Edge runtime.
  runtime: "nodejs",
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
