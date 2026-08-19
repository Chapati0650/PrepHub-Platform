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

const isAppRoute = (pathname: string) => pathname.startsWith("/home") || pathname.startsWith("/settings");

// No isAuthRoute -> isAuthed -> redirect("/home") branch here on purpose —
// removed after a real, confirmed infinite redirect loop: this middleware's
// isAuthed check only decodes the JWT (no DB call, deliberately, to keep the
// Edge runtime fast — see the file-level comment above), so it can't see a
// revoked tokenVersion (password change, "log out all devices", account
// deletion). A cookie left over from exactly that case still decodes fine
// here, so visiting /login got bounced straight to /home — but /home's full,
// DB-backed check in (app)/layout.tsx correctly sees the revoked token and
// redirects right back to /login, which this middleware then bounces to
// /home again, forever. Confirmed directly via curl -L: /home -> /login ->
// /home -> /login until curl's own redirect-limit gave up, matching a real
// blank-white-screen report. A genuinely-still-logged-in visitor seeing the
// login form instead of an automatic bounce is a minor, harmless UX
// redundancy; a loop that can strand any visitor on a blank page is not.
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isAuthed = Boolean(req.auth?.user);

  if (isAppRoute(pathname) && !isAuthed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
});

export const config = {
  // Skip static assets and Next internals; everything else (including API
  // routes) still goes through so /api/auth/* keeps working.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
