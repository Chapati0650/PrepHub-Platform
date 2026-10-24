import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  attemptsToWaive,
  coreAttempts,
  diagnosticStage,
  isBonusDifficulty,
  pendingBonusAttempts,
  sequenceIndex,
  unansweredAttempts,
  type DiagnosticStage,
} from "./sequence";

/**
 * The database side of the staged Diagnostic. The rules themselves are pure
 * and live in sequence.ts; this file only reads sessions and writes the
 * consequences of those rules.
 */

/**
 * Moves a session begun under the old fixed order onto the staged one.
 *
 * Re-sequences the existing attempts — same questions, same answers, new
 * positions — so a returning student picks up where the new order says they
 * should rather than on the Reading passage that lost them. Nothing answered
 * is touched: an answered question keeps its answer, including a Hard one
 * answered early under the old order, which then simply counts.
 *
 * Idempotent and race-safe. The format flip is a conditional update that only
 * one caller can win; the loser sees zero rows changed and leaves the
 * positions alone. Positions are rewritten in two passes because
 * `(diagnosticSessionId, position)` is unique, and permuting values in place
 * would collide halfway through.
 *
 * Two statements rather than one update per row: this runs inside an
 * interactive transaction, whose default timeout is five seconds, and 42
 * sequential round trips to a database in another region is uncomfortably
 * close to it.
 */
export async function convertLegacySession(sessionId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const flipped = await tx.diagnosticSession.updateMany({
      where: { id: sessionId, format: "FULL_21", status: "IN_PROGRESS" },
      data: { format: "STAGED" },
    });
    if (flipped.count === 0) return;

    const attempts = await tx.diagnosticAttempt.findMany({ where: { diagnosticSessionId: sessionId } });
    const ordered = [...attempts].sort(
      (a, b) => sequenceIndex(a.category, a.difficulty) - sequenceIndex(b.category, b.difficulty),
    );

    if (ordered.length > 0) {
      // Pass one moves every row clear of the target range; pass two lands
      // it. The ranges never overlap, so neither pass can collide with itself.
      await tx.$executeRaw`
        UPDATE "diagnostic_attempts" SET "position" = "position" + 1000
         WHERE "diagnosticSessionId" = ${sessionId}
      `;
      const values = ordered.map((a, position) => Prisma.sql`(${a.id}::text, ${position}::int)`);
      await tx.$executeRaw`
        UPDATE "diagnostic_attempts" AS a SET "position" = v.position
          FROM (VALUES ${Prisma.join(values)}) AS v(id, position)
         WHERE a."id" = v.id
      `;
    }

    // Resume on the first unanswered core question, indexed within the core
    // list the runner will be given.
    const core = ordered.filter((a) => !isBonusDifficulty(a.difficulty));
    const firstOpen = core.findIndex((a) => a.submittedAt === null);
    await tx.diagnosticSession.update({
      where: { id: sessionId },
      data: { currentPosition: firstOpen === -1 ? 0 : firstOpen },
    });
  });
}

/**
 * Settles the bonus round once the core is finished: waives every Hard
 * question that wasn't earned. Safe to call at any time — it does nothing
 * while the core is unfinished, and nothing twice.
 *
 * The update is guarded on the question still being unanswered and unwaived,
 * so a Hard question answered in another tab between the read and the write
 * keeps its answer.
 */
export async function settleBonusRound(sessionId: string): Promise<void> {
  const attempts = await prisma.diagnosticAttempt.findMany({ where: { diagnosticSessionId: sessionId } });
  const toWaive = attemptsToWaive(attempts);
  if (toWaive.length === 0) return;
  await prisma.diagnosticAttempt.updateMany({
    where: { id: { in: toWaive.map((a) => a.id) }, submittedAt: null, waivedAt: null },
    data: { waivedAt: new Date() },
  });
}

export type AdvanceResult =
  | { kind: "CORE_INCOMPLETE"; unanswered: number }
  | { kind: "BONUS"; remaining: number }
  | { kind: "DONE" };

/**
 * What "Continue" or "Finish" does, decided entirely on the server.
 *
 * The client never decides whether a bonus round exists: it doesn't know which
 * question is which category or difficulty, and shouldn't. From the core it
 * either reports what's left, opens the bonus round, or — for a student who
 * earned no Hard questions — goes straight to done.
 *
 * Entering the bonus round resets `currentPosition`, which is indexed within
 * whichever list the runner is showing; left at the core's last index, the
 * bonus runner would open partway through its own list.
 */
export async function advanceDiagnostic(studentId: string): Promise<AdvanceResult> {
  const session = await prisma.diagnosticSession.findUnique({
    where: { studentId },
    include: { attempts: true },
  });
  if (!session) return { kind: "CORE_INCOMPLETE", unanswered: 0 };

  const openCore = coreAttempts(session.attempts).filter((a) => a.submittedAt === null);
  if (openCore.length > 0) return { kind: "CORE_INCOMPLETE", unanswered: openCore.length };

  await settleBonusRound(session.id);

  // `session.attempts` predates the waiving above, but that can't mislead
  // this: pendingBonusAttempts judges "earned" from the Medium answers, so a
  // question just waived was already unearned and is excluded either way.
  const pending = pendingBonusAttempts(session.attempts);
  if (pending.length > 0) {
    const bonusStarted = session.attempts.some((a) => isBonusDifficulty(a.difficulty) && a.submittedAt !== null);
    if (!bonusStarted) {
      await prisma.diagnosticSession.update({ where: { id: session.id }, data: { currentPosition: 0 } });
    }
    return { kind: "BONUS", remaining: pending.length };
  }
  return { kind: "DONE" };
}

/** The stage a session is in, for routing. Settles the bonus round first. */
export async function currentStage(sessionId: string): Promise<DiagnosticStage> {
  await settleBonusRound(sessionId);
  const attempts = await prisma.diagnosticAttempt.findMany({ where: { diagnosticSessionId: sessionId } });
  return diagnosticStage(attempts);
}

export { unansweredAttempts };
