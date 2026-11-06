import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getConsoleState } from "@/lib/guided/console";
import { GuidedError } from "@/lib/guided/errors";
import { getTeacherContext } from "@/lib/teacher/access";
import { logUnauthorizedAccess } from "@/lib/logger";

// The teacher's console: names and answers, for the teacher who runs the
// session only, and never cached anywhere.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_req: Request, ctx: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "TEACHER") {
    logUnauthorizedAccess("Non-teacher requested a Guided Session console", {
      accountId: session?.user?.id,
      role: session?.user?.role,
    });
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const context = await getTeacherContext(session.user.id);
  if (!context) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  const { sessionId } = await ctx.params;
  try {
    return NextResponse.json(await getConsoleState(context, sessionId), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof GuidedError && err.code === "NOT_FOUND") {
      return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
    }
    throw err;
  }
}
