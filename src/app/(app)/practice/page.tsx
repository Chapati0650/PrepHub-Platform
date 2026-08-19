import { redirect } from "next/navigation";
import { PencilLine, Lock, AlertCircle } from "lucide-react";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { hasPaidAccess } from "@/lib/entitlements";
import { generatePracticeSet } from "@/lib/adaptive/generate-practice-set";
import { LinkButton } from "@/components/ui/link-button";

// PRD-005 — the thin gateway between the Dashboard and the active Practice
// Session. Never opens a question directly; always shows set state first.
export default async function PracticePage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
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
        <div className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <AlertCircle className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl sm:text-2xl">We&apos;re having trouble preparing your next practice set.</h1>
        <p className="text-muted-foreground">Your progress is safe. Please try again in a moment.</p>
        <div className="flex gap-3">
          <LinkButton href="/practice">Try Again</LinkButton>
          <LinkButton variant="outline" href="/home">
            Back to Dashboard
          </LinkButton>
        </div>
      </div>
    );
  }

  const questionsCompleted = set.slots.filter((s) => s.finalizedAttempt !== null).length;

  if (!paidAccess) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
        <div className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Lock className="size-5" aria-hidden />
        </div>
        <h1 className="text-xl sm:text-2xl">Your first personalized practice set is ready.</h1>
        <p className="text-muted-foreground">Subscribe to continue with 21 questions selected from your diagnostic performance.</p>
        <QuestionProgressPips total={set.slots.length} completed={0} dimmed />
        <LinkButton size="lg" href="/pricing">
          View Plans
        </LinkButton>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-8 text-center">
      <div className="inline-flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
        <PencilLine className="size-5" aria-hidden />
      </div>
      <h1 className="text-xl sm:text-2xl">Practice Set {set.setNumber}</h1>
      <p className="text-muted-foreground">21 Questions</p>
      <QuestionProgressPips total={set.slots.length} completed={questionsCompleted} />
      {questionsCompleted > 0 && (
        <p className="text-sm text-muted-foreground">
          {questionsCompleted} of {set.slots.length} questions completed
        </p>
      )}
      <p className="text-sm">Personalized from your performance.</p>
      <LinkButton size="lg" href="/practice/session">
        {questionsCompleted > 0 ? "Continue Practice" : "Start Practice"}
      </LinkButton>
    </div>
  );
}

// A real, at-a-glance visual for how far into the set you are — replaces a
// bare "X of Y completed" line with something you can actually scan.
function QuestionProgressPips({ total, completed, dimmed = false }: { total: number; completed: number; dimmed?: boolean }) {
  return (
    <div className="flex flex-wrap justify-center gap-1.5" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`size-2.5 rounded-full ${
            dimmed ? "bg-muted" : i < completed ? "bg-primary" : "bg-muted"
          }`}
        />
      ))}
    </div>
  );
}
