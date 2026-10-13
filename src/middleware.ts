import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { RUSH_JOIN_COOKIE, RUSH_JOIN_COOKIE_MAX_AGE } from "@/lib/rush/join-cookie";

// Deliberately named middleware.ts, not proxy.ts (Next.js 16's renamed
// convention) — Netlify's Next.js Runtime (OpenNext-based) doesn't yet
// support proxy.ts at all as of this writing (confirmed via a real deploy:
// every page 500'd with "nextHandler is not a function", and the same
// failure is a known open issue against the adapter). middleware.ts is
// deprecated but still fully functional, so this trades a build-time
// deprecation notice for an actually-working deployment. Revisit once
// Netlify's adapter adds proxy.ts support.
//
// Uses next-auth/jwt's getToken() directly, NOT the `auth((req) => {...})`
// wrapper NextAuth(authConfig) previously produced — that wrapper isn't a
// pure request gate, confirmed by reading its source
// (node_modules/next-auth/lib/index.js's handleAuth): on every single
// request it makes, it internally re-checks the session via an in-process
// call to the /session action and unconditionally re-appends that action's
// Set-Cookie headers to the final response, regardless of what the actual
// route/action does. That's an automatic "rolling session" refresh, and it
// runs on every request this middleware's matcher covers (which is nearly
// everything) — including a Server Action that's deliberately calling
// signOut() in the very same request. Confirmed live as the real cause of a
// serious bug: "Log out of all devices" bumps tokenVersion and calls
// signOut() correctly, but middleware's own wrapper independently re-issued
// a fresh, still-valid session cookie for the same request, silently
// undoing the logout — the account never actually got signed out, so the
// very next login attempt (or even just revisiting the app) immediately
// looked "logged in" again with stale, revoked credentials, surfacing as an
// endless log-in-then-bounced-back loop no matter how many times the user
// tried. getToken() only decodes the cookie already on the request — no
// internal request, no Set-Cookie side effects — so it can't interfere with
// whatever the actual page/action does with the session in the same request.
const isAppRoute = (pathname: string) => pathname.startsWith("/home") || pathname.startsWith("/settings");

// The landing page's "already signed in? go to the product" redirect lives
// here rather than in the page (2026-09-28). `auth()` in a Server Component
// makes its route dynamic, so that one call forced a Node function to boot
// and server-render the marketing page for *every* visitor, including the
// first-timer with no session at all — measured on production at a 1.59s
// TTFB cold versus 0.42s warm. Deciding it here instead lets `/` be a
// prerendered, CDN-served page. Middleware only decodes the JWT cookie (no
// database), so the signed-out path stays cheap.
const isLanding = (pathname: string) => pathname === "/";

// A friend's 1v1 Rush link (/rush/join/<code>) is the one URL a person with
// no account is expected to open. Signed out, they go to signup with the
// code kept in a cookie so /home can bring them back to the challenge once
// they're in (a fresh account passes through onboarding first, and
// redirect targets don't survive that chain). Signed in, the cookie is
// cleared here so /home stops redirecting.
const joinCodeOf = (pathname: string) => pathname.match(/^\/rush\/join\/([A-Za-z0-9-]{1,12})$/)?.[1] ?? null;

export default async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const joinCode = joinCodeOf(pathname);
  if (!isAppRoute(pathname) && !joinCode && !isLanding(pathname)) return NextResponse.next();

  const token = await getToken({
    req,
    secret: process.env.AUTH_SECRET,
    secureCookie: req.nextUrl.protocol === "https:",
  });

  // `userId` (not the bare token) is the "really signed in" signal, matching
  // what the page used to check: a deleted account's cookie still decodes
  // until it expires, and its jwt callback returns an empty token — such a
  // visitor should see the landing page, not bounce through /home.
  if (isLanding(pathname)) {
    if (token?.userId) return NextResponse.redirect(new URL("/home", req.url));
    return NextResponse.next();
  }

  if (joinCode) {
    if (token) {
      const res = NextResponse.next();
      if (req.cookies.has(RUSH_JOIN_COOKIE)) res.cookies.delete(RUSH_JOIN_COOKIE);
      return res;
    }
    const res = NextResponse.redirect(new URL("/signup", req.url));
    res.cookies.set(RUSH_JOIN_COOKIE, joinCode, { httpOnly: true, sameSite: "lax", path: "/", maxAge: RUSH_JOIN_COOKIE_MAX_AGE });
    return res;
  }

  if (!token) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  return NextResponse.next();
}

export const config = {
  // Only the three paths this middleware actually acts on.
  //
  // It previously matched everything except Next's own static output, which
  // meant Netlify booted an edge function for every request on the site —
  // every API route, every RSC payload, every file in /public, and the
  // landing page itself. Measured on production: `/` came back with
  // `Age: 72643` (a CDN hit, so no server render at all) and still took
  // ~0.5s TTFB, because the edge function ran in front of the cached asset.
  //
  // Narrowing this is safe: middleware was never the authorization boundary.
  // It gates only /home and /settings; every other app page calls `auth()`
  // and redirects on its own (CLAUDE.md: "all authorization is server-side"),
  // which was confirmed route by route before this change.
  matcher: ["/", "/home/:path*", "/settings/:path*", "/rush/join/:path*"],
};
