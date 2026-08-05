import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getDiagnosticResultsData } from "@/lib/session/session-results-data";
import { SessionResults } from "@/components/session/session-results";
import { loadDiagnosticQuestionDetailAction } from "../actions";

// PRD-012 §23/§24 — the diagnostic's "standard completed-set results
// experience," reusing PRD-007's Session Review component.
export default async function DiagnosticResultsPage() {
  const session = await auth();
  if (!session?.user) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const diagnostic = await prisma.diagnosticSession.findUnique({ where: { studentId: session.user.id } });
  if (!diagnostic) redirect("/diagnostic");
  if (diagnostic.status !== "COMPLETED") redirect("/diagnostic");

  const data = await getDiagnosticResultsData(session.user.id);

  return <SessionResults data={data} loadQuestionDetail={loadDiagnosticQuestionDetailAction} />;
}
