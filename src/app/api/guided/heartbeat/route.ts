import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { guidedHeartbeat } from "@/lib/guided/student";

// A student's screen checking in during a Guided Session, so the teacher sees
// who has drifted to another tab ("Away"). Sent with sendBeacon when the tab is
// hidden, so it must accept a plain-text body. A route handler rather than a
// Server Action, so it never waits behind the student's answer.
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return new NextResponse(null, { status: 204 });
  let body: { sessionId?: unknown; hidden?: unknown } = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (typeof body.sessionId === "string" && body.sessionId.length <= 64) {
    await guidedHeartbeat(session.user.id, body.sessionId, body.hidden === true);
  }
  return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
