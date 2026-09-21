import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getDiagnosticResultsData } from "@/lib/session/session-results-data";
import { diagnosticVerdict, weakestCategories } from "@/lib/session/verdict";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { SessionResults } from "@/components/session/session-results";
import { ParentSummary } from "@/components/session/parent-summary";
import { loadDiagnosticQuestionDetailAction } from "../actions";

// PRD-012 §23/§24 — the diagnostic's "standard completed-set results
// experience," reusing PRD-007's Session Review component, plus the two
// things this page is really for: the one-sentence analysis the landing
// page promises, and the way forward — set a target (the onboarding
// wizard, which now follows the results) and open the free first set.
export default async function DiagnosticResultsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");

  const [diagnostic, user] = await Promise.all([
    prisma.diagnosticSession.findUnique({ where: { studentId: session.user.id } }),
    prisma.user.findUniqueOrThrow({ where: { id: session.user.id }, select: { onboardingCompletedAt: true, role: true } }),
  ]);
  if (!diagnostic) redirect("/diagnostic");
  if (diagnostic.status !== "COMPLETED") redirect("/diagnostic");

  const data = await getDiagnosticResultsData(session.user.id);
  const needsOnboarding = user.role === "STUDENT" && !user.onboardingCompletedAt;
  const verdict = diagnosticVerdict(data.mastery);
  const weak = weakestCategories(data.mastery).map((c) => CATEGORY_LABELS[c]);
  const summary = [
    `PrepHub Diagnostic result: predicted SAT score ${data.currentRange.min}–${data.currentRange.max} (${data.stats.correct}/${data.stats.total} correct).`,
    `Weakest areas: ${weak.join(" and ")}.`,
    `The Diagnostic and the first personalized practice set are free. PrepHub Premium (every set after that, updated predictions, the 800 Club and 1v1 Rush) is $25/month at launch or $99/year — prephubtp.com/pricing.`,
  ].join("\n");

  return (
    <SessionResults
      data={{ ...data, continueHref: needsOnboarding ? "/onboarding" : "/practice" }}
      loadQuestionDetail={loadDiagnosticQuestionDetailAction}
      verdict={verdict}
      continueLabel={needsOnboarding ? "Set your target score" : "Start your free practice set"}
      extra={<ParentSummary text={summary} />}
    />
  );
}
