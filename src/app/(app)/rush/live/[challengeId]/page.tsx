import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getLiveState } from "@/lib/rush/live";
import { LiveRush } from "./live-rush";
import { pollLiveAction, serveLiveQuestionAction, submitLiveAnswerAction } from "../../actions";

// A live room. No paid-access check on purpose: a run in a live room only
// exists because startRushAction (Premium-gated) or joinRushAction (free
// by design) created it. getLiveState returns null for anyone without a
// run here, which is the ownership gate.
export default async function LiveRushPage({ params }: { params: Promise<{ challengeId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const { challengeId } = await params;
  const state = await getLiveState(session.user.id, challengeId);
  if (!state) redirect("/rush");
  if (state.status === "FINISHED") redirect(`/rush/results/${challengeId}`);

  const joinUrl = `${process.env.NEXTAUTH_URL ?? "http://localhost:3000"}/rush/join/${state.code}`;
  return <LiveRush initial={state} joinUrl={joinUrl} poll={pollLiveAction} serve={serveLiveQuestionAction} submit={submitLiveAnswerAction} />;
}
