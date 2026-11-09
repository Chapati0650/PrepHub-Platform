import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getAccessSummary, hasPaidAccess } from "@/lib/entitlements";
import { getDiagnosticResultsData } from "@/lib/session/session-results-data";
import { diagnosticVerdict, weakestCategories } from "@/lib/session/verdict";
import { CATEGORY_LABELS } from "@/lib/content/labels";
import { SessionResults } from "@/components/session/session-results";
import { ParentSummary } from "@/components/session/parent-summary";
import { loadDiagnosticQuestionDetailAction } from "../actions";
import { predictionText } from "@/lib/score/display";

export const metadata = { title: "Diagnostic results" };

// PRD-012 §23/§24 — the diagnostic's "standard completed-set results
// experience," reusing PRD-007's Session Review component, plus the two
// things this page is really for: the one-sentence analysis the landing
// page promises, and the way forward — the free first set. (Onboarding
// runs before the Diagnostic; the fallback below only catches an account
// that somehow skipped it.)
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

  const [data, access, paid, setsDone] = await Promise.all([
    getDiagnosticResultsData(session.user.id),
    getAccessSummary(session.user.id),
    hasPaidAccess(session.user.id),
    // Reopened later (from Progress), the next step isn't "your free practice set" (review, 2026-11-09).
    prisma.practiceSet.count({ where: { studentId: session.user.id, status: "COMPLETED" } }),
  ]);
  const needsOnboarding = user.role === "STUDENT" && !user.onboardingCompletedAt;
  const verdict = diagnosticVerdict(data.mastery);
  const weak = weakestCategories(data.mastery).map((c) => CATEGORY_LABELS[c]);
  const summary = [
    `PrepHub Diagnostic result: predicted SAT score ${predictionText(data.currentRange)} (${data.stats.correct}/${data.stats.total} correct).`,
    `Weakest areas: ${weak.join(" and ")}.`,
    // The price is for a family that would be paying. Quoting it to a
    // family whose school already covers Premium is the "selling someone
    // what their school pays for" mistake the district bar exists to avoid.
    access.type === "SCHOOL"
      ? `${access.organizationName} provides PrepHub Premium, so every personalized practice set after this is free for this student.`
      : paid
        ? `This student has PrepHub Premium: a new personalized practice set after every one they finish, with the prediction updated each time.`
        : `The Diagnostic and the first personalized practice set are free. PrepHub Premium (every set after that, updated predictions, the 800 Club and 1v1 Rush) is $25/month at launch or $99/year — prephubtp.com/pricing.`,
  ].join("\n");

  return (
    <SessionResults
      data={{ ...data, continueHref: needsOnboarding ? "/onboarding" : "/practice" }}
      loadQuestionDetail={loadDiagnosticQuestionDetailAction}
      verdict={verdict}
      continueLabel={needsOnboarding ? "Set your target score" : setsDone > 0 ? "Continue practicing" : paid ? "Start your first practice set" : "Start your free practice set"}
      extra={<ParentSummary text={summary} />}
      // An Administrator's /home is the admin area; this is their student dashboard.
      backHref={user.role === "SCHOOL_ADMINISTRATOR" ? "/home?view=student" : "/home"}
    />
  );
}
