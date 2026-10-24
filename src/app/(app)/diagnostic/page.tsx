import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { canUseStudentExperience } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { getStudentQuestionContent, getStudentQuestionFeedback } from "@/lib/session/question-content";
import { finalizeDiagnosticCompletion } from "@/lib/diagnostic/complete-diagnostic";
import { coreAttempts, isBonusDifficulty, pendingBonusAttempts, CORE_QUESTION_COUNT } from "@/lib/diagnostic/sequence";
import { convertLegacySession, currentStage } from "@/lib/diagnostic/stages";
import type { SessionRunnerItem } from "@/components/session/session-runner";
import { IntroScreens } from "./intro-screens";
import { DiagnosticRunner } from "./diagnostic-runner";
import { BonusRoundIntro } from "./bonus-round-intro";
import { beginDiagnosticAction } from "./actions";

type Attempt = {
  id: string;
  submittedAt: Date | null;
  answer: string | null;
  isCorrect: boolean | null;
  draftAnswer: string | null;
  skipped: boolean;
  questionRevisionId: string;
};

/**
 * The runner indexes its items by array position, so each stage is handed its
 * own list renumbered from zero. The attempt id is what every server action
 * keys on, so the renumbering never reaches the database.
 */
function toItems(list: Attempt[]): SessionRunnerItem[] {
  return list.map((a, index) => ({
    id: a.id,
    position: index,
    submitted: a.submittedAt !== null,
    studentAnswer: a.answer,
    isCorrect: a.isCorrect,
    draftAnswer: a.draftAnswer,
    skipped: a.skipped,
  }));
}

/** Resume where the student was, unless that question is already answered —
 * then the first one still open, so a reload never lands on finished work. */
function startingIndex(list: Attempt[], saved: number): number {
  const clamped = Math.min(Math.max(saved, 0), list.length - 1);
  if (list[clamped] && list[clamped].submittedAt === null) return clamped;
  const firstOpen = list.findIndex((a) => a.submittedAt === null);
  return firstOpen === -1 ? clamped : firstOpen;
}

// PRD-012 §5/§27 — routes the student to the correct diagnostic state: Not
// Started (intro), In Progress (the core, or the bonus round), Completed
// (results). The staged format and its reasoning are in
// src/lib/diagnostic/sequence.ts.
export default async function DiagnosticPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await auth();
  if (!session?.user?.id) redirect("/home");
  if (!canUseStudentExperience(session.user.role)) redirect("/home");
  const studentId = session.user.id;
  const { round } = await searchParams;

  const found = await prisma.diagnosticSession.findUnique({ where: { studentId } });

  if (!found) {
    return <IntroScreens onBegin={beginDiagnosticAction} />;
  }

  if (found.status === "COMPLETED") {
    redirect("/diagnostic/results");
  }

  // A session begun under the old fixed order is moved onto the staged one
  // before anything reads its positions. Idempotent; see stages.ts.
  if (found.format === "FULL_21") await convertLegacySession(found.id);

  // Settles the bonus round (waives the Hard questions that weren't earned)
  // before reading attempts, so the lists below already reflect it.
  const stage = await currentStage(found.id);

  const diagnostic = await prisma.diagnosticSession.findUniqueOrThrow({
    where: { studentId },
    include: { attempts: { orderBy: { position: "asc" } } },
  });

  // Content-coverage fallback (see start-diagnostic.ts): if literally nothing
  // was published anywhere, the session can exist with zero attempts. There's
  // nothing to run — complete it immediately (every category falls back to
  // its conservative "missing = incorrect" Ability Score) instead of the
  // runner crashing on an empty question list. The same applies to a student
  // who finished the core and earned no bonus questions: they are done.
  if (diagnostic.attempts.length === 0 || stage === "DONE") {
    await finalizeDiagnosticCompletion(studentId);
    redirect("/diagnostic/results");
  }

  if (stage === "CORE") {
    const core = coreAttempts(diagnostic.attempts);
    const index = startingIndex(core, diagnostic.currentPosition);
    const content = await getStudentQuestionContent(core[index].questionRevisionId);
    const feedback = core[index].submittedAt ? await getStudentQuestionFeedback(core[index].questionRevisionId) : null;
    return (
      <DiagnosticRunner
        title="Diagnostic"
        itemLabel="Question"
        // "Continue", not "Finish": what comes next is either the bonus round
        // or the results, and the server decides which. The client never
        // learns which question was which category or difficulty.
        finishLabel="Continue"
        studentName={session.user.name ?? undefined}
        items={toItems(core)}
        initialPosition={index}
        initialQuestion={{ content, feedback }}
      />
    );
  }

  // BONUS. Every Hard question not waived — the ones still to answer, plus
  // any answered already, which for a converted legacy session may include
  // one answered early under the old order.
  const bonus = diagnostic.attempts.filter((a) => isBonusDifficulty(a.difficulty) && a.waivedAt === null);
  const pending = pendingBonusAttempts(diagnostic.attempts);
  const started = bonus.some((a) => a.submittedAt !== null);

  if (!started && round !== "bonus") {
    return (
      <BonusRoundIntro
        count={pending.length}
        categories={pending.map((a) => a.category)}
        coreCount={CORE_QUESTION_COUNT}
      />
    );
  }

  // Until a bonus question has been answered, `currentPosition` still holds
  // wherever the student was in the core — a student who answered the
  // fourteenth question and closed the tab never clicked Continue, so
  // advanceDiagnostic never reset it, and the bonus round opened on its last
  // question. Found by driving exactly that path. Ignore it until the bonus
  // runner has saved a position of its own.
  const index = startingIndex(bonus, started ? diagnostic.currentPosition : 0);
  const content = await getStudentQuestionContent(bonus[index].questionRevisionId);
  const feedback = bonus[index].submittedAt ? await getStudentQuestionFeedback(bonus[index].questionRevisionId) : null;
  return (
    <DiagnosticRunner
      title="Diagnostic · Bonus round"
      itemLabel="Bonus question"
      finishLabel="See my results"
      studentName={session.user.name ?? undefined}
      items={toItems(bonus)}
      initialPosition={index}
      initialQuestion={{ content, feedback }}
    />
  );
}
