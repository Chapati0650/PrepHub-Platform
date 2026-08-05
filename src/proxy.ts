import { NextResponse } from "next/server";
import { auth } from "@/auth";

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
  // Proxy defaults to the Node.js runtime (Next 16+), which the jwt callback in
  // src/auth.ts needs since it hits Postgres via the pg driver adapter.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
