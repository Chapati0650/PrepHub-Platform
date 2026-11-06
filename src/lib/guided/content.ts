import type { QuestionType } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { isAnswerCorrect } from "@/lib/adaptive/grading";
import type { StudentQuestionContent } from "@/lib/session/question-content";
import type { AssignedQuestionKey } from "@/lib/teacher/answer-stats";

/**
 * Everything a Guided Session needs about one question revision, loaded once
 * per server instance. A published revision never changes (an edit makes a
 * new one), so the cache can't go stale; it's bounded so a long-lived
 * instance doesn't grow without limit.
 *
 * `content` is what students may see before answering; the rest (which choice
 * is right, the explanation) is only ever sent once the room reaches the
 * reveal, by the callers.
 */
export type RevisionInfo = {
  content: StudentQuestionContent;
  questionType: QuestionType;
  choices: { id: string; isCorrect: boolean; distractor: string | null }[];
  acceptedAnswers: string[];
  steps: { text: string; imageId: string | null }[];
  /** One rule to remember, when the explanation has one. */
  takeaway: string | null;
};

const CACHE_LIMIT = 500;
const cache = new Map<string, RevisionInfo>();

function takeawayOf(walkthrough: unknown): string | null {
  if (walkthrough && typeof walkthrough === "object" && "takeaway" in walkthrough) {
    const value = (walkthrough as { takeaway?: unknown }).takeaway;
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function loadRevisions(revisionIds: string[]): Promise<Map<string, RevisionInfo>> {
  const out = new Map<string, RevisionInfo>();
  const missing = [...new Set(revisionIds)].filter((id) => {
    const hit = cache.get(id);
    if (hit) out.set(id, hit);
    return !hit;
  });
  if (missing.length > 0) {
    const revisions = await prisma.questionRevision.findMany({
      where: { id: { in: missing } },
      include: {
        question: { select: { questionType: true } },
        answerChoices: { orderBy: { order: "asc" } },
        explanationSteps: { orderBy: { order: "asc" } },
      },
    });
    if (cache.size + revisions.length > CACHE_LIMIT) cache.clear();
    for (const r of revisions) {
      const info: RevisionInfo = {
        content: {
          questionRevisionId: r.id,
          questionType: r.question.questionType,
          questionText: r.questionText,
          passageText: r.passageText,
          questionImageId: r.questionImageId,
          calculatorSetting: r.calculatorSetting,
          suggestedTimeSeconds: r.suggestedTimeSeconds,
          answerChoices: r.answerChoices.map((c) => ({ id: c.id, text: c.text, imageId: c.imageId })),
        },
        questionType: r.question.questionType,
        choices: r.answerChoices.map((c) => ({ id: c.id, isCorrect: c.isCorrect, distractor: c.distractorExplanation })),
        acceptedAnswers: r.acceptedAnswers,
        steps: r.explanationSteps.length > 0
          ? r.explanationSteps.map((s) => ({ text: s.text, imageId: s.imageId }))
          : r.writtenExplanation
            ? [{ text: r.writtenExplanation, imageId: null }]
            : [],
        takeaway: takeawayOf(r.walkthrough),
      };
      cache.set(r.id, info);
      out.set(r.id, info);
    }
  }
  return out;
}

export async function loadRevision(revisionId: string): Promise<RevisionInfo> {
  const info = (await loadRevisions([revisionId])).get(revisionId);
  if (!info) throw new Error(`Question revision ${revisionId} not found.`);
  return info;
}

export function grade(info: RevisionInfo, answer: string): boolean {
  return isAnswerCorrect(info.questionType, answer, {
    answerChoices: info.choices.map((c) => ({ id: c.id, isCorrect: c.isCorrect })),
    acceptedAnswers: info.acceptedAnswers,
  });
}

export function answerKeyOf(info: RevisionInfo): AssignedQuestionKey {
  return {
    questionType: info.questionType,
    choices: info.choices.map((c) => ({ id: c.id, isCorrect: c.isCorrect })),
    acceptedAnswers: info.acceptedAnswers,
  };
}

export function correctChoiceId(info: RevisionInfo): string | null {
  return info.choices.find((c) => c.isCorrect)?.id ?? null;
}

/** A typed answer, trimmed and bounded. Null for nothing usable. */
export function cleanAnswer(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.length > 200) return null;
  return value;
}
