import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { hasPaidAccess } from "@/lib/entitlements";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { Button } from "@/components/ui/button";

// PRD-005 — the thin gateway between the Dashboard and the active Practice
// Session. Never opens a question directly; always shows set state first.
export default async function PracticePage() {
  const session = await auth();
  if (!session?.user) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;

  const diagnostic = await prisma.diagnosticSession.findUnique({ where: { studentId } });
  if (diagnostic?.status !== "COMPLETED") redirect("/diagnostic");

  const paidAccess = await hasPaidAccess(studentId);

  let set = await prisma.practiceSet.findFirst({
    where: { studentId, status: "ACTIVE" },
    include: { slots: { include: { finalizedAttempt: true } } },
  });

  let generationFailed = false;
  if (!set) {
    try {
      const created = await generatePracticeSet(studentId);
      set = await prisma.practiceSet.findFirst({
        where: { id: created.id },
        include: { slots: { include: { finalizedAttempt: true } } },
      });
    } catch {
      generationFailed = true;
    }
  }

  if (generationFailed || !set) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">We&apos;re having trouble preparing your next practice set.</h1>
        <p className="text-muted-foreground">Your progress is safe. Please try again in a moment.</p>
        <div className="flex gap-3">
          <Button render={<Link href="/practice">Try Again</Link>} />
          <Button variant="outline" render={<Link href="/home">Back to Dashboard</Link>} />
        </div>
      </div>
    );
  }

  const questionsCompleted = set.slots.filter((s) => s.finalizedAttempt !== null).length;

  if (!paidAccess) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <h1 className="text-xl font-semibold">Your first personalized practice set is ready.</h1>
        <p className="text-muted-foreground">Subscribe to continue with 21 questions selected from your diagnostic performance.</p>
        <Button size="lg" render={<Link href="/pricing">View Plans</Link>} />
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Practice Set {set.setNumber}</h1>
      <p className="text-muted-foreground">21 Questions</p>
      {questionsCompleted > 0 && (
        <p className="text-sm text-muted-foreground">
          {questionsCompleted} of {set.slots.length} questions completed
        </p>
      )}
      <p className="text-sm">Personalized from your performance.</p>
      <Button size="lg" render={<Link href="/practice/session">{questionsCompleted > 0 ? "Continue Practice" : "Start Practice"}</Link>} />
    </div>
  );
}
