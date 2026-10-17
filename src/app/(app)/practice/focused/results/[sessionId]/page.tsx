import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getFocusedResults } from "@/lib/focused/sessions";
import { FocusedResultsView } from "./focused-results";
import { loadFocusedQuestionDetailAction } from "../../actions";

export default async function FocusedResultsPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const { sessionId } = await params;
  const results = await getFocusedResults(session.user.id, sessionId);
  if (!results) redirect("/practice/focused");

  return <FocusedResultsView data={results} loadQuestionDetail={loadFocusedQuestionDetailAction} />;
}
