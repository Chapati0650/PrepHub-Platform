import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getPracticeSetResultsData } from "@/lib/session/session-results-data";
import { SessionResults } from "@/components/session/session-results";
import { loadPracticeQuestionDetailAction } from "../../actions";

export const metadata = { title: "Practice Set results" };

// PRD-007 — Session Review & Results for one completed adaptive practice set.
export default async function PracticeResultsPage({ params }: { params: Promise<{ setId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const { setId } = await params;
  const set = await prisma.practiceSet.findUnique({ where: { id: setId } });
  if (!set || set.studentId !== session.user.id) redirect("/practice");
  if (set.status !== "COMPLETED") redirect("/practice");

  const data = await getPracticeSetResultsData(session.user.id, setId);

  // An Administrator's /home is the admin area; their student dashboard is
  // the view the sidebar's "Student dashboard" asks for.
  const backHref = session.user.role === "SCHOOL_ADMINISTRATOR" ? "/home?view=student" : "/home";
  return <SessionResults data={data} loadQuestionDetail={loadPracticeQuestionDetailAction} backHref={backHref} />;
}
