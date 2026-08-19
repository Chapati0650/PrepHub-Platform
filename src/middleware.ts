import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/auth.config";

// Deliberately named middleware.ts, not proxy.ts (Next.js 16's renamed
// convention) — Netlify's Next.js Runtime (OpenNext-based) doesn't yet
// support proxy.ts at all as of this writing (confirmed via a real deploy:
// every page 500'd with "nextHandler is not a function", and the same
// failure is a known open issue against the adapter). middleware.ts is
// deprecated but still fully functional, so this trades a build-time
// deprecation notice for an actually-working deployment. Revisit once
// Netlify's adapter adds proxy.ts support.
//
// Uses its own NextAuth instance built from the Edge-safe authConfig, not
// the full one exported by @/auth (which needs Postgres via the Prisma
// adapter) — Netlify's adapter also doesn't support Node.js-runtime
// middleware (confirmed the same way: every protected route 500'd even
// after this file was renamed and explicit runtime: "nodejs" was set,
// while everything middleware doesn't touch — static assets, _next/static —
// worked fine). See auth.config.ts for why this doesn't weaken session
// revocation: src/app/(app)/layout.tsx already independently re-checks the
// full, DB-backed session on every protected page render.
const { auth } = NextAuth(authConfig);

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
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
