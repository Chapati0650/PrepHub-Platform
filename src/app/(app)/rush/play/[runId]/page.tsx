import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getRunContext } from "@/lib/rush/runs";
import { RushRunner } from "./rush-runner";
import { serveRushQuestionAction, submitRushAnswerAction } from "../../actions";

// The rush itself. No paid-access check here on purpose: a run only exists
// because startRushAction (Premium-gated) or joinRushAction (free by
// design) created it, and the free path is the whole point of the hook.
// Ownership is the gate — getRunContext returns null for anyone but the
// run's student.
//
// The page deliberately does not serve the first question: the clock
// starts when a question is served, and serving during SSR would start it
// before the student has even seen the screen. The runner's Start button
// serves it.
export default async function RushPlayPage({ params }: { params: Promise<{ runId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const { runId } = await params;
  const run = await getRunContext(session.user.id, runId);
  if (!run) redirect("/rush");
  if (run.live) redirect(`/rush/live/${run.challengeId}`);
  if (run.status === "COMPLETED") redirect(`/rush/results/${run.challengeId}`);

  return <RushRunner run={run} serve={serveRushQuestionAction} submit={submitRushAnswerAction} />;
}
