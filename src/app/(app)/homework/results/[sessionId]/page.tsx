import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getHomeworkResults } from "@/lib/teacher/homework";
import { HomeworkResults } from "./homework-results";
import { loadHomeworkQuestionDetailAction } from "../../actions";

export default async function HomeworkResultsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "STUDENT") redirect("/home");

  const { sessionId } = await params;
  const results = await getHomeworkResults(session.user.id, sessionId);
  if (!results) redirect("/homework");

  return <HomeworkResults data={results} loadQuestionDetail={loadHomeworkQuestionDetailAction} />;
}
