import { notFound, redirect } from "next/navigation";
import { requireTeacher } from "@/lib/teacher/access";
import { getTeacherView } from "@/lib/guided/console";
import { GuidedError } from "@/lib/guided/errors";
import { ConsoleView } from "./console-view";
import { MonitorView } from "./monitor-view";

export const metadata = { title: "Guided Session" };

/**
 * The teacher's laptop during a session, by name and never projected: the
 * controls and the room for a teacher-led session, the monitor for individual practice.
 */
export default async function GuidedConsolePage({ params }: { params: Promise<{ sessionId: string }> }) {
  const context = await requireTeacher();
  const { sessionId } = await params;
  let state;
  try {
    state = await getTeacherView(context, sessionId);
  } catch (err) {
    if (err instanceof GuidedError && err.code === "NOT_FOUND") notFound();
    throw err;
  }
  if (state.status === "ENDED") redirect(`/teacher/classes/${state.classroomId}/live/${sessionId}`);
  return state.mode === "INDIVIDUAL" ? <MonitorView initial={state} /> : <ConsoleView initial={state} />;
}
