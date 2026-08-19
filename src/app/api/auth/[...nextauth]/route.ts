import { NextRequest } from "next/server";
import { handlers } from "@/auth";

// Auth.js links a new OAuth account to whoever's session cookie is present
// on the incoming /api/auth/callback/<provider> request (confirmed by
// reading @auth/core's handleLoginOrRegister directly — it's the
// "add another provider to my currently signed-in account" feature, which
// this app never offers). Google is this app's primary sign-in method, not
// an add-on, so a Google sign-in must always resolve strictly by the
// authenticated Google profile's own email, never by whatever session
// happened to already be active in the browser.
//
// /api/auth/google-sign-in's two-hop redirect closes the common path
// (clicking the button), but a user can still reach this exact callback
// carrying a stale session cookie by using the browser's back button to
// resume an in-progress Google auth flow after a different session was
// already established meanwhile — confirmed live in production: a genuine
// Owner Google identity ended up linked to an unrelated Student account this
// way. Stripping the session cookie here, unconditionally, for every GET
// OAuth callback guarantees Auth.js never has a session to link against, no
// matter how the request arrived. Only the session-token cookie (and its
// chunked .0/.1/... suffixes for large JWTs) is removed — csrf-token,
// callback-url, pkce/state cookies are left untouched since the OAuth
// handshake itself still needs them.
const SESSION_COOKIE_PATTERN = /(?:^|;\s*)(__Secure-|__Host-)?authjs\.session-token(?:\.\d+)?=[^;]*/g;

export async function GET(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/api/auth/callback/")) {
    return handlers.GET(request);
  }

  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader || !/authjs\.session-token/.test(cookieHeader)) {
    return handlers.GET(request);
  }

  const strippedCookieHeader = cookieHeader.replace(SESSION_COOKIE_PATTERN, "").replace(/^;\s*/, "").trim();
  const headers = new Headers(request.headers);
  if (strippedCookieHeader) {
    headers.set("cookie", strippedCookieHeader);
  } else {
    headers.delete("cookie");
  }

  const strippedRequest = new NextRequest(request.url, { headers, method: request.method });
  return handlers.GET(strippedRequest);
}

export const POST = handlers.POST;
