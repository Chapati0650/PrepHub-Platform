import { NextResponse } from "next/server";
import { getClassRushShared } from "@/lib/rush/class-rush";

// A Class Rush's shared state, polled every second by every student screen in
// the game. Like a Guided Session's (app/api/guided/state): the key is
// unguessable and only given to the class's students and teacher, and what it
// returns is what the projector shows, never one student's answer, so the
// edge may answer for a second and thirty screens cost about one database
// read a second. Each cache miss also moves the game on (advanceClassRush),
// so it never waits on the teacher's tab being in front.
//
// A GET route, not a Server Action: Next runs a client's Server Actions one
// at a time, and a poll would queue in front of a student's answer.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) return NextResponse.json({ ok: false }, { status: 404 });
  const state = await getClassRushShared(key);
  if (!state) return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, max-age=1, stale-while-revalidate=1",
    },
  });
}
