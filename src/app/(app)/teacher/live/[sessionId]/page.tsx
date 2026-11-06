import { notFound, redirect } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getConsoleState } from "@/lib/guided/console";
import { GuidedError } from "@/lib/guided/errors";
import { ConsoleView } from "./console-view";

export const metadata = { title: "Guided Session" };

/** The teacher's laptop during a session: the controls and the room, by name. Never projected. */
export default async function GuidedConsolePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const context = await requireTeacher();
  const { sessionId } = await params;
  let state;
  try {
    state = await getConsoleState(context, sessionId);
  } catch (err) {
    if (err instanceof GuidedError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  if (state.status === "ENDED") redirect(`/teacher/classes/${state.classroomId}/live/${sessionId}`);
  return <ConsoleView initial={state} />;
}
