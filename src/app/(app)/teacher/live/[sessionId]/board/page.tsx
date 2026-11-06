import { notFound } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { requireOwnedSession } from "@/lib/guided/control";
import { GuidedError } from "@/lib/guided/errors";
import { getSharedState } from "@/lib/guided/state";
import { BoardView } from "./board-view";

export const metadata = { title: "Board" };

/**
 * What goes on the projector. It shows only the room's shared state, so
 * nothing about any one student can reach it: no names, and no vote split
 * until the room is done answering.
 */
export default async function GuidedBoardPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const context = await requireTeacher();
  const { sessionId } = await params;
  let session;
  try {
    session = await requireOwnedSession(context, sessionId);
  } catch (err) {
    if (err instanceof GuidedError) notFound();
    throw err;
  }
  const initial = await getSharedState(session.stateKey);
  return <BoardView stateKey={session.stateKey} initial={initial} />;
}
