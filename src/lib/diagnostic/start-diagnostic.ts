import type { QuestionDifficulty } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { ALL_CATEGORIES } from "@/lib/adaptive/config";
import { createRandom, generateSeed, shuffle } from "@/lib/adaptive/random";
import { DiagnosticError } from "./errors";
import { selectDiagnosticQuestion } from "./question-selection";

const DIAGNOSTIC_DIFFICULTIES: QuestionDifficulty[] = ["EASY", "MEDIUM", "HARD"];

// PRD-012 §16 — "PrepHub does not provide a normal Retake"; a student has at
// most one DiagnosticSession, ever (DiagnosticSession.studentId is unique).
// Returning the existing session unchanged is both the resume path and the
// idempotent guard against double-generation.
export async function startOrResumeDiagnostic(studentId: string) {
  const existing = await prisma.diagnosticSession.findUnique({
    where: { studentId },
    include: { attempts: { orderBy: { position: "asc" } } },
  });
  if (existing) return existing;

  const random = createRandom(generateSeed());
  const excludeQuestionIds = new Set<string>();
  const planned: { category: (typeof ALL_CATEGORIES)[number]; difficulty: QuestionDifficulty }[] = [];
  for (const category of ALL_CATEGORIES) {
    for (const difficulty of DIAGNOSTIC_DIFFICULTIES) {
      planned.push({ category, difficulty });
    }
  }

  const resolved: { category: (typeof ALL_CATEGORIES)[number]; difficulty: QuestionDifficulty; questionId: string; questionRevisionId: string }[] =
    [];
  const failures: string[] = [];
  for (const slot of planned) {
    const selected = await selectDiagnosticQuestion({
      category: slot.category,
      difficulty: slot.difficulty,
      excludeQuestionIds,
      random,
    });
    if (!selected) {
      failures.push(`${slot.category}/${slot.difficulty}`);
      continue;
    }
    excludeQuestionIds.add(selected.questionId);
    resolved.push({ ...slot, ...selected });
  }

  if (failures.length > 0) {
    throw new DiagnosticError("GENERATION_FAILED", `Unable to select diagnostic questions for: ${failures.join(", ")}`);
  }

  // §12 — question order should feel smooth and not visibly group by
  // category; a full shuffle across all 21 satisfies that without revealing
  // difficulty groupings.
  shuffle(resolved, random);

  return prisma.diagnosticSession.create({
    data: {
      studentId,
      status: "IN_PROGRESS",
      currentPosition: 0,
      attempts: {
        create: resolved.map((slot, position) => ({
          position,
          category: slot.category,
          difficulty: slot.difficulty,
          questionId: slot.questionId,
          questionRevisionId: slot.questionRevisionId,
        })),
      },
    },
    include: { attempts: { orderBy: { position: "asc" } } },
  });
}
