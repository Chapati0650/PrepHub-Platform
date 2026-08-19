import { signIn, signOut } from "@/auth";

// A plain Route Handler, not a client-side signOut()+signIn() pair — that
// two-request client sequence is a real timing dependency (confirmed via a
// second real incident: even with the client-side fix, a Google account got
// linked to the currently-logged-in user again, most likely from testing
// across multiple tabs where one tab's stale page still had a valid session
// by the time its sign-in click landed). A GET to this route does both
// steps server-side, sequentially, inside one request — no client JS timing
// involved at all, so there's no window for a stale session to slip through.
// The underlying reason this needs to happen at all: Auth.js links a new
// OAuth account to whoever's already logged in, rather than switching to
// it, whenever a session cookie is present when the sign-in completes.
export async function GET() {
  await signOut({ redirect: false });
  return signIn("google", { redirectTo: "/home" });
}
