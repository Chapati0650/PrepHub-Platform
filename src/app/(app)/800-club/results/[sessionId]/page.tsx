import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { getClubResults } from "@/lib/club/sessions";
import { ClubResults } from "./club-results";
import { loadClubQuestionDetailAction } from "../../actions";

export const metadata = { title: "800 Club results" };

export default async function ClubResultsPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const { sessionId } = await params;
  const results = await getClubResults(session.user.id, sessionId);
  if (!results) redirect("/800-club");

  return <ClubResults data={results} loadQuestionDetail={loadClubQuestionDetailAction} />;
}
