import { signIn } from "@/auth";
import { safeNextPath } from "@/lib/auth/next-path";

// Second hop of the sign-out-then-sign-in flow — see the parent route's
// comment. By the time the browser reaches this request, it already applied
// the previous response's Set-Cookie deletion, so this request has no
// session cookie at all and signIn() can't link to a stale identity.
export async function GET(request: Request) {
  const next = safeNextPath(new URL(request.url).searchParams.get("next"));
  return signIn("google", { redirectTo: next ?? "/home" });
}
