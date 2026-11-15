import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { ClassRushError, getClassRushConsole } from "@/lib/rush/class-rush";
import { getTeacherContext } from "@/lib/teacher/access";
import { logUnauthorizedAccess } from "@/lib/logger";

// The teacher's Class Rush screen: who's in, who has answered, the answer.
// For the teacher who opened the game only, and never cached.
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function GET(_req: Request, ctx: { params: Promise<{ rushId: string }> }) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "TEACHER") {
    logUnauthorizedAccess("Non-teacher requested a Class Rush console", { accountId: session?.user?.id, role: session?.user?.role });
    return NextResponse.json({ ok: false }, { status: 401, headers: NO_STORE });
  }
  const context = await getTeacherContext(session.user.id);
  if (!context) return NextResponse.json({ ok: false }, { status: 403, headers: NO_STORE });
  const { rushId } = await ctx.params;
  try {
    return NextResponse.json(await getClassRushConsole(context, rushId), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof ClassRushError && err.code === "NOT_FOUND") return NextResponse.json({ ok: false }, { status: 404, headers: NO_STORE });
    throw err;
  }
}
