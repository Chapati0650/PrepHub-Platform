import { NextResponse } from "next/server";
import { getSharedState } from "@/lib/guided/state";

// The room's shared state, polled by the projector and every student screen
// in a Guided Session. The key is unguessable and only ever given to people
// in the room (the teacher's pages and enrolled students' session page), and
// what it returns is exactly what the projector shows: nothing about any one
// student. That is what lets the edge cache it for a second, so thirty screens
// cost about one database read a second instead of thirty.
//
// A GET route handler, not a Server Action: Next runs a client's Server
// Actions one at a time, so a poll would queue in front of a student's answer.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(key)) return NextResponse.json({ ok: false }, { status: 404 });
  const state = await getSharedState(key);
  if (!state) {
    return NextResponse.json({ ok: false }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json(state, {
    headers: {
      // Browsers always ask again; Netlify's edge may answer for a second.
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Netlify-CDN-Cache-Control": "public, max-age=1, stale-while-revalidate=1",
    },
  });
}
