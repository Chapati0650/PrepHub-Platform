import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { logUnauthorizedAccess } from "@/lib/logger";

// The Owner check for the content area's route handlers — the same rule as
// actions.ts's requireOwner (role OWNER, the attempt logged otherwise), but
// answering with a status a fetch() can read instead of redirecting, which
// for a fetch would just hand back the /home page as the "result".
//
// These handlers exist because Next dispatches Server Actions one at a time
// per client (node_modules/next/dist/docs, "Server Actions and Mutations",
// "Sequential dispatch on the client"): bulk upload's pool of three and the
// difficulty estimator's pool of three were each running one request at a
// time. A Route Handler called with fetch has no such queue.
export async function requireOwnerRequest(): Promise<NextResponse | null> {
  const session = await auth();
  if (session?.user.role === "OWNER") return null;
  logUnauthorizedAccess("Non-Owner attempted an Owner-only content request", {
    accountId: session?.user.id,
    role: session?.user.role,
  });
  return NextResponse.json({ error: "Only the Owner can do this. Sign in again if your session ended." }, { status: 403 });
}
