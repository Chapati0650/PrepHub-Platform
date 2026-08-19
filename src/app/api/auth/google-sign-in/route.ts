import { NextResponse } from "next/server";
import { signOut } from "@/auth";

// A genuine two-request browser round trip, not signOut()+signIn() inside one
// handler — confirmed insufficient by reading @auth/core's own
// handleLoginOrRegister directly (node_modules/@auth/core/lib/actions/
// callback/handle-login.js:206-212): whether a new Google account gets
// *linked to whoever's already logged in* is decided from the session cookie
// on the incoming /api/auth/callback/google request, and clearing a cookie
// via signOut() only takes effect once the browser receives and re-sends it —
// it's still present on any request made within the same round trip. Calling
// signOut() then signIn() back-to-back in one handler leaves the stale
// session cookie on the request that later reaches Google's callback, so
// linking still silently happened (confirmed live: the Owner account
// accumulated 3 different Google identities after that "fix" was deployed
// and had already been verified once). Redirecting here forces the browser
// to actually apply the Set-Cookie deletion and send a brand-new request
// before signIn() ever runs, so there is no session left for the callback to
// link against.
// On Netlify, request.url reflects the Next.js function's own internal
// deploy-ID origin (e.g. https://<deploy-id>--prephubtp.netlify.app), not the
// public domain the browser is actually on — confirmed live via a real
// browser: the redirect below sent the browser to that internal origin,
// which the browser's CORS policy then correctly refused to follow, silently
// breaking the entire Google sign-in flow. The Host header (or
// x-forwarded-host behind a proxy) reflects what the browser actually sent,
// so it's used instead of trusting request.url's origin.
function getPublicOrigin(request: Request): string {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return new URL(request.url).origin;
  const protocol = request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
  return `${protocol}://${host}`;
}

export async function GET(request: Request) {
  await signOut({ redirect: false });
  return NextResponse.redirect(new URL("/api/auth/google-sign-in/start", getPublicOrigin(request)));
}
