import type {
  MediaAsset,
  Question,
  QuestionAnswerChoice,
  QuestionFamily,
  QuestionRevision,
} from "@/generated/prisma/client";
import { FAMILY_VERSION_COUNT, MULTIPLE_CHOICE_OPTION_COUNT } from "./constants";
import { ContentError } from "./errors";
// Type-only — erased at compile time, so this doesn't pull families.ts's
// Prisma-importing runtime code into any bundle that imports this module
// (notably Client Components, which call getFamilyPublishIssues below).
import type { QuestionFamilyWithContent } from "./families";

export type RevisionForValidation = QuestionRevision & {
  answerChoices: QuestionAnswerChoice[];
  standaloneVideo: MediaAsset | null;
};

export type FamilyForValidation = QuestionFamily & { sharedVideo: MediaAsset | null };

// PRD-013 §20 Publishing Checklist + PRD-015 §5.5 mandatory-preview and §9.3
// video-readiness rules. Shared by preview (informational) and publish
// (blocking) so the two surfaces can never drift apart.
export function getPublishIssues(
  question: Question,
  revision: RevisionForValidation,
  family: FamilyForValidation | null,
): string[] {
  const issues: string[] = [];

  if (!revision.questionText.trim()) issues.push("Question text is required.");
  if (!revision.suggestedTimeSeconds || revision.suggestedTimeSeconds <= 0) {
    issues.push("Suggested time is required.");
  }

  if (question.questionType === "MULTIPLE_CHOICE") {
    if (revision.answerChoices.length !== MULTIPLE_CHOICE_OPTION_COUNT) {
      issues.push(`Multiple-choice questions need exactly ${MULTIPLE_CHOICE_OPTION_COUNT} answer choices.`);
    } else if (revision.answerChoices.some((c) => !c.text.trim())) {
      issues.push("Every answer choice needs text.");
    }
    const correctCount = revision.answerChoices.filter((c) => c.isCorrect).length;
    if (correctCount !== 1) issues.push("Exactly one answer choice must be marked correct.");
  } else {
    if (revision.acceptedAnswers.length === 0) {
      issues.push("At least one accepted answer is required.");
    }
  }

  // Video explanations are optional (not a PRD-013 publish requirement) —
  // but one that's attached and still mid-processing/failed would leave a
  // broken reference live to students, so that half of the check stays.
  if (question.familyId) {
    if (family?.sharedVideo && family.sharedVideo.status !== "READY") {
      issues.push("The family's shared video is still processing or failed to process.");
    }
  } else {
    if (revision.standaloneVideo && revision.standaloneVideo.status !== "READY") {
      issues.push("The video explanation is still processing or failed to process.");
    }
  }

  if (!revision.previewCompletedAt) {
    issues.push("Student Preview must be opened for the latest changes before publishing.");
  }

  if (question.status === "ARCHIVED") {
    issues.push("Archived questions cannot be published.");
  }

  return issues;
}

export function assertPublishable(
  question: Question,
  revision: RevisionForValidation,
  family: FamilyForValidation | null,
): void {
  const issues = getPublishIssues(question, revision, family);
  if (issues.length > 0) {
    throw new ContentError("PUBLISH_VALIDATION_FAILED", issues.join(" "));
  }
}

// Lives here (not families.ts) so Client Components — e.g. the family editor's
// "not yet publishable" panel — can call it without pulling families.ts's
// Prisma import into the browser bundle.
export function getFamilyPublishIssues(family: QuestionFamilyWithContent): string[] {
  const issues: string[] = [];
  if (family.questions.length !== FAMILY_VERSION_COUNT) {
    issues.push(`This family needs exactly ${FAMILY_VERSION_COUNT} versions (currently ${family.questions.length}).`);
    return issues;
  }
  for (const question of family.questions) {
    const revision = question.currentDraftRevision ?? question.currentPublishedRevision;
    if (!revision) {
      issues.push("One version has no content to publish.");
      continue;
    }
    issues.push(...getPublishIssues(question, revision, family));
  }
  return Array.from(new Set(issues));
}
