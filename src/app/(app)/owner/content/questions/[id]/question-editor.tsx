"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ChevronLeft, ChevronRight, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { toast } from "@/components/ui/toast";
import { ExplanationSteps } from "@/components/content/explanation-steps";
import { getPublishIssues, type RevisionForValidation } from "@/lib/content/validation";
import {
  CATEGORY_ORDER,
  DIFFICULTY_ORDER,
  getCalculatorSettingForCategory,
  getSuggestedTimeForDifficulty,
} from "@/lib/content/constants";
import { CATEGORY_LABELS, CALCULATOR_LABELS, DIFFICULTY_LABELS, STATUS_LABELS } from "@/lib/content/labels";
import type { QuestionContentPatch, QuestionWithContent } from "@/lib/content/questions";
import type { MediaAsset } from "@/generated/prisma/client";
import { MediaUploadField } from "../../media-upload-field";
import { StudentPreviewSheet } from "../student-preview-sheet";
import {
  archiveQuestionAction,
  generateExplanationAction,
  generateDistractorExplanationsAction,
  generateStepDiagramAction,
  getQuestionAction,
  markAiReviewedAction,
  markPreviewCompletedAction,
  publishQuestionAction,
  restoreQuestionAction,
  transcribeQuestionImageAction,
  unpublishQuestionAction,
  updateQuestionContentAction,
} from "../../actions";

type SaveState = "idle" | "unsaved" | "saving" | "saved" | "failed";

function mediaUrl(id: string | null | undefined): string | null {
  return id ? `/api/owner/media/${id}` : null;
}

// MediaUploadField only calls onUploaded once processing has succeeded — for
// the fields here that's always a READY asset, so it's safe to stub the rest
// of the MediaAsset shape (getPublishIssues only ever reads .status off these).
function readyMediaStub(id: string): MediaAsset {
  return {
    id,
    kind: "IMAGE",
    status: "READY",
    storageKey: "",
    originalFilename: "",
    mimeType: "",
    sizeBytes: 0,
    durationSeconds: null,
    width: null,
    height: null,
    failureReason: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export type QuestionEditorNavigation = {
  prevHref: string | null;
  nextHref: string | null;
  position: number;
  total: number;
};

export function QuestionEditor({
  question: initialQuestion,
  navigation,
}: {
  question: QuestionWithContent;
  navigation?: QuestionEditorNavigation | null;
}) {
  const router = useRouter();
  const [question, setQuestion] = useState(initialQuestion);
  const revision = question.currentDraftRevision ?? question.currentPublishedRevision!;
  const isFamilyMember = question.familyId !== null;
  const isArchived = question.status === "ARCHIVED";
  const isEditable = !isArchived;

  const [questionText, setQuestionText] = useState(revision.questionText);
  const [category, setCategory] = useState(question.category);
  const [difficulty, setDifficulty] = useState(question.difficulty);
  const calculatorSetting = getCalculatorSettingForCategory(category);
  const suggestedTimeSeconds = getSuggestedTimeForDifficulty(difficulty);
  const [writtenExplanation, setWrittenExplanation] = useState(revision.writtenExplanation ?? "");
  const [explanationSteps, setExplanationSteps] = useState(
    revision.explanationSteps.map((s) => ({ text: s.text, imageId: s.imageId as string | null })),
  );
  const [acceptedAnswersText, setAcceptedAnswersText] = useState(revision.acceptedAnswers.join("\n"));
  const [choices, setChoices] = useState(
    revision.answerChoices.length === 4
      ? revision.answerChoices.map((c) => ({
          text: c.text,
          isCorrect: c.isCorrect,
          imageId: c.imageId as string | null,
          distractorExplanation: c.distractorExplanation as string | null,
        }))
      : Array.from({ length: 4 }, () => ({
          text: "",
          isCorrect: false,
          imageId: null as string | null,
          distractorExplanation: null as string | null,
        })),
  );
  const [generatingDistractors, setGeneratingDistractors] = useState(false);
  const [questionImageId, setQuestionImageId] = useState<string | null>(revision.questionImageId);
  const [standaloneVideoId, setStandaloneVideoId] = useState<string | null>(revision.standaloneVideoId);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewQuestion, setPreviewQuestion] = useState(initialQuestion);
  const [actionPending, setActionPending] = useState(false);
  const [navigating, setNavigating] = useState(false);

  // A status-changing action (archive, publish, unpublish...) can move this
  // question out of whatever filtered list it was opened from — e.g.
  // archiving drops it out of the default view, which excludes ARCHIVED — so
  // the router.refresh() that follows recomputes `navigation` as null even
  // though nothing about "what's next in the list" actually became unknown.
  // Keep the last real navigation around (reset only when a genuinely
  // different question mounts, since this component is keyed by question.id)
  // so Previous/Next stay usable instead of vanishing right when they're
  // most useful — moving on to the next question in a batch right after
  // archiving/publishing this one.
  const [navigationSnapshot, setNavigationSnapshot] = useState<QuestionEditorNavigation | null>(navigation ?? null);
  if (navigation && navigation !== navigationSnapshot) {
    setNavigationSnapshot(navigation);
  }
  const effectiveNavigation = navigation ?? navigationSnapshot;

  const [transcribing, setTranscribing] = useState(false);
  const [transcribeError, setTranscribeError] = useState<string | null>(null);
  const transcribeInputRef = useRef<HTMLInputElement>(null);

  const [generatingExplanation, setGeneratingExplanation] = useState(false);
  const [generateExplanationError, setGenerateExplanationError] = useState<string | null>(null);
  const [generatingDiagramForStep, setGeneratingDiagramForStep] = useState<number | null>(null);

  const pendingPatch = useRef<QuestionContentPatch>({});
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fills the form from a photo/screenshot of a question — the uploaded
  // photo itself is never stored, it's only sent through once to produce a
  // text draft (plus, if the photo includes a graph/table/diagram, a
  // cropped image of just that element, uploaded the same way a manual
  // "Question image" upload would be). Same review path as typing the
  // question by hand: nothing here saves without going through queueSave,
  // and nothing publishes without the existing preview-then-publish gate.
  async function handleTranscribeFile(file: File) {
    setTranscribeError(null);
    setTranscribing(true);
    const formData = new FormData();
    formData.set("file", file);
    const result = await transcribeQuestionImageAction(formData);
    setTranscribing(false);
    if (result.error) {
      setTranscribeError(result.error);
      return;
    }
    const { questionText: transcribedText, answerChoices, questionImageId: transcribedImageId } = result.transcription!;
    setQuestionText(transcribedText);
    queueSave({ questionText: transcribedText });
    if (answerChoices && question.questionType === "MULTIPLE_CHOICE") {
      const nextChoices = choices.map((choice, i) =>
        answerChoices[i] !== undefined ? { ...choice, text: answerChoices[i] } : choice,
      );
      setChoices(nextChoices);
      queueSave({ answerChoices: nextChoices });
    }
    if (transcribedImageId) {
      setQuestionImageId(transcribedImageId);
      queueSave({ questionImageId: transcribedImageId });
    }
  }

  // Needs the correct answer already marked/entered — the model explains why
  // that specific answer is right rather than independently re-solving (and
  // potentially disagreeing with it). Replaces the whole step list, same as
  // Generate on the transcription side; review/edit below before saving.
  const canGenerateExplanation =
    questionText.trim().length > 0 &&
    (question.questionType === "MULTIPLE_CHOICE"
      ? choices.some((c) => c.isCorrect)
      : acceptedAnswersText.trim().length > 0);

  function buildExplanationGenerationInput() {
    return {
      questionText,
      category: CATEGORY_LABELS[category],
      questionType: question.questionType as "MULTIPLE_CHOICE" | "OPEN_ENDED_NUMERIC",
      answerChoices: question.questionType === "MULTIPLE_CHOICE" ? choices.map((c) => c.text) : null,
      correctChoiceIndex: question.questionType === "MULTIPLE_CHOICE" ? choices.findIndex((c) => c.isCorrect) : null,
      acceptedAnswers: acceptedAnswersText
        .split("\n")
        .map((a) => a.trim())
        .filter(Boolean),
    };
  }

  async function handleGenerateExplanation() {
    setGenerateExplanationError(null);
    setGeneratingExplanation(true);
    const result = await generateExplanationAction(buildExplanationGenerationInput());
    setGeneratingExplanation(false);
    if (result.error) {
      setGenerateExplanationError(result.error);
      return;
    }
    const next = result.steps!.map((s) => ({ text: s.text, imageId: null as string | null }));
    setExplanationSteps(next);
    queueSave({ explanationSteps: next });

    // Best-effort, MULTIPLE_CHOICE only — needs the steps just generated
    // above as context (see generateDistractorExplanations). A failure here
    // doesn't roll back the correct-answer explanation that already saved
    // successfully; the Owner can retry from "Generate distractor notes"
    // below, or write them by hand.
    if (question.questionType === "MULTIPLE_CHOICE") {
      void handleGenerateDistractors(next.map((s) => s.text));
    }
  }

  async function handleGenerateDistractors(correctExplanationSteps: string[]) {
    const correctChoiceIndex = choices.findIndex((c) => c.isCorrect);
    if (correctChoiceIndex === -1 || correctExplanationSteps.length === 0) return;

    setGenerateExplanationError(null);
    setGeneratingDistractors(true);
    const result = await generateDistractorExplanationsAction({
      questionText,
      category: CATEGORY_LABELS[category],
      answerChoices: choices.map((c) => c.text),
      correctChoiceIndex,
      correctExplanationSteps,
    });
    setGeneratingDistractors(false);
    if (result.error) {
      setGenerateExplanationError(result.error);
      return;
    }
    const byIndex = new Map(result.distractors!.map((d) => [d.choiceIndex, d.explanation]));
    const next = choices.map((c, i) => ({ ...c, distractorExplanation: byIndex.get(i) ?? c.distractorExplanation }));
    setChoices(next);
    queueSave({ answerChoices: next });
  }

  // Separate, opt-in, and meaningfully more expensive than text generation
  // (real code execution to draw the chart) — see generate-explanation.ts.
  // Scoped to one step at a time so cost stays proportional to how many
  // diagrams are actually wanted, not generated automatically on every step.
  async function handleGenerateStepDiagram(index: number) {
    setGeneratingDiagramForStep(index);
    setGenerateExplanationError(null);
    const result = await generateStepDiagramAction({
      ...buildExplanationGenerationInput(),
      stepText: explanationSteps[index].text,
    });
    setGeneratingDiagramForStep(null);
    if (result.error) {
      setGenerateExplanationError(result.error);
      return;
    }
    const next = explanationSteps.map((s, i) => (i === index ? { ...s, imageId: result.imageId ?? s.imageId } : s));
    setExplanationSteps(next);
    queueSave({ explanationSteps: next });
  }

  function queueSave(patch: QuestionContentPatch) {
    if (!isEditable) return;
    pendingPatch.current = { ...pendingPatch.current, ...patch };
    setSaveState("unsaved");
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => void flush(), 1500);
  }

  async function flush(): Promise<boolean> {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const patch = pendingPatch.current;
    if (Object.keys(patch).length === 0) return true;
    pendingPatch.current = {};
    setSaveState("saving");
    const result = await updateQuestionContentAction(question.id, patch);
    if (result.error) {
      setSaveState("failed");
      setSaveError(result.error);
      pendingPatch.current = { ...patch, ...pendingPatch.current };
      return false;
    }
    setSaveState("saved");
    // A save can silently flip status — a Question Family member still
    // starts that family's Draft Revision on first edit (see
    // ensureDraftRevision), and Published standalone questions publish the
    // edit immediately but the badge/aiAnswerReasoning banner can still
    // depend on freshly-saved fields — so refresh either way to keep the
    // badge/action buttons truthful.
    await refreshQuestion();
    return true;
  }

  // PRD-015 §6.4: warn before leaving the tab while a save is pending or failed.
  useEffect(() => {
    function handler(e: BeforeUnloadEvent) {
      if (saveState === "unsaved" || saveState === "saving" || saveState === "failed") {
        e.preventDefault();
      }
    }
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [saveState]);

  async function refreshQuestion() {
    const fresh = await getQuestionAction(question.id);
    setQuestion(fresh);
    return fresh;
  }

  async function openPreview() {
    const flushed = await flush();
    if (!flushed) return;
    // The Sheet also marks preview-completion itself on open, but fire-and-forget
    // there — awaiting it here closes the race where an Owner immediately hits
    // Publish right after closing Preview, before that write has landed.
    await markPreviewCompletedAction(question.id);
    const fresh = await refreshQuestion();
    setPreviewQuestion(fresh);
    setPreviewOpen(true);
  }

  // Flushes any pending debounced edit before leaving — a plain <Link> would
  // unmount this component immediately on click, discarding whatever hasn't
  // hit the 1500ms debounce yet (same risk queueSave/flush already guards
  // against for Preview/Publish).
  async function goToQuestion(href: string | null) {
    if (!href) return;
    setNavigating(true);
    const flushed = await flush();
    if (!flushed) {
      setNavigating(false);
      return;
    }
    router.push(href);
  }

  async function runStatusAction(action: (id: string) => Promise<{ error?: string }>, successMessage: string) {
    setActionPending(true);
    const result = await action(question.id);
    setActionPending(false);
    if (result.error) {
      toast.add({ title: "Action failed", description: result.error, type: "error" });
      return;
    }
    toast.add({ title: successMessage, type: "success" });
    await refreshQuestion();
    router.refresh();
  }

  // Publishes immediately on click, no confirmation step — flush() persists
  // any pending edit first since the server action publishes whatever's
  // currently saved, not whatever's still sitting in local state.
  async function publishNow() {
    const flushed = await flush();
    if (!flushed) return;
    await runStatusAction(
      publishQuestionAction,
      question.status === "DRAFT_REVISION" ? "Question republished" : "Question published",
    );
  }

  // The publish checklist must reflect what's currently typed, not just the
  // last-saved server revision — using stale `revision` fields here would show
  // wrong/outdated warnings while the Owner is actively editing.
  const liveRevision: RevisionForValidation = {
    ...revision,
    questionText,
    calculatorSetting,
    suggestedTimeSeconds,
    writtenExplanation: writtenExplanation || null,
    acceptedAnswers:
      question.questionType === "OPEN_ENDED_NUMERIC"
        ? acceptedAnswersText
            .split("\n")
            .map((a) => a.trim())
            .filter(Boolean)
        : [],
    questionImageId: questionImageId,
    standaloneVideoId: standaloneVideoId,
    standaloneVideo: standaloneVideoId ? readyMediaStub(standaloneVideoId) : null,
    answerChoices: choices.map((c, i) => ({
      id: `local-${i}`,
      revisionId: revision.id,
      order: i,
      text: c.text,
      isCorrect: c.isCorrect,
      imageId: c.imageId,
      distractorExplanation: c.distractorExplanation,
    })),
  };
  const publishIssues = getPublishIssues(question, liveRevision, question.family);
  const canPublish = !isFamilyMember && (question.status === "DRAFT" || question.status === "DRAFT_REVISION");
  const canUnpublish = !isFamilyMember && (question.status === "PUBLISHED" || question.status === "DRAFT_REVISION");
  const canArchive = !isFamilyMember && question.status === "DRAFT";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/owner/content/questions"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Questions
          </Link>
          <Badge variant={question.status === "PUBLISHED" ? "default" : "secondary"}>
            {STATUS_LABELS[question.status]}
          </Badge>
          {isFamilyMember && (
            <Link href={`/owner/content/families/${question.familyId}`} className="text-sm underline">
              Part of a Question Family
            </Link>
          )}
        </div>
        <div className="flex items-center gap-3">
          <SaveStatusIndicator state={saveState} error={saveError} onRetry={() => void flush()} />
          {canPublish && (
            <Button size="sm" disabled={actionPending || publishIssues.length > 0} onClick={() => void publishNow()}>
              {question.status === "DRAFT_REVISION" ? "Republish" : "Publish"}
            </Button>
          )}
        </div>
      </div>

      {effectiveNavigation && (effectiveNavigation.prevHref || effectiveNavigation.nextHref) && (
        <div className="flex items-center justify-center gap-3 rounded-md border border-border py-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!effectiveNavigation.prevHref || navigating}
            onClick={() => void goToQuestion(effectiveNavigation.prevHref)}
          >
            <ChevronLeft className="size-4" aria-hidden />
            Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Question {effectiveNavigation.position} of {effectiveNavigation.total}
          </span>
          <Button
            size="sm"
            variant="ghost"
            disabled={!effectiveNavigation.nextHref || navigating}
            onClick={() => void goToQuestion(effectiveNavigation.nextHref)}
          >
            Next
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </div>
      )}

      {revision.aiGenerated && !revision.aiReviewedAt && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Sparkles className="size-3.5 shrink-0" aria-hidden />
          <span>Created by bulk upload — not required before publishing.</span>
          {revision.aiAnswerReasoning && <span className="italic">{revision.aiAnswerReasoning}</span>}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 px-2 text-xs"
            onClick={() => runStatusAction(markAiReviewedAction, "Marked as reviewed")}
          >
            Mark as Reviewed
          </Button>
        </div>
      )}

      {isArchived && (
        <Alert>
          <AlertDescription>
            This question is archived and read-only.{" "}
            <button className="underline" onClick={() => runStatusAction(restoreQuestionAction, "Question restored")}>
              Restore it
            </button>{" "}
            to edit again.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editable form */}
        <div className="flex flex-col gap-4">
          {isEditable && (
            <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Transcribe from image</p>
                  <p className="text-xs text-muted-foreground">
                    Upload a photo or screenshot of a question to fill in the text (and any graph/table/diagram)
                    below. Review it before saving — nothing publishes automatically.
                  </p>
                </div>
                <input
                  ref={transcribeInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleTranscribeFile(file);
                    e.target.value = "";
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={transcribing}
                  onClick={() => transcribeInputRef.current?.click()}
                >
                  {transcribing ? "Transcribing…" : "Upload image"}
                </Button>
              </div>
              {transcribeError && (
                <Alert variant="destructive">
                  <AlertDescription>{transcribeError}</AlertDescription>
                </Alert>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label htmlFor="questionCategory">Category</Label>
              {isFamilyMember ? (
                <p className="text-sm text-muted-foreground">{CATEGORY_LABELS[category]} (set by the family)</p>
              ) : (
                <Select
                  value={category}
                  disabled={!isEditable}
                  onValueChange={(v) => {
                    const next = v as typeof category;
                    setCategory(next);
                    queueSave({ category: next });
                  }}
                >
                  <SelectTrigger id="questionCategory">
                    <SelectValue>{(v: typeof category) => CATEGORY_LABELS[v]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORY_ORDER.map((c) => (
                      <SelectItem key={c} value={c}>
                        {CATEGORY_LABELS[c]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="questionDifficulty">Difficulty</Label>
              {isFamilyMember ? (
                <p className="text-sm text-muted-foreground">{DIFFICULTY_LABELS[difficulty]} (set by the family)</p>
              ) : (
                <Select
                  value={difficulty}
                  disabled={!isEditable}
                  onValueChange={(v) => {
                    const next = v as typeof difficulty;
                    setDifficulty(next);
                    queueSave({ difficulty: next });
                  }}
                >
                  <SelectTrigger id="questionDifficulty">
                    <SelectValue>{(v: typeof difficulty) => DIFFICULTY_LABELS[v]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {DIFFICULTY_ORDER.map((d) => (
                      <SelectItem key={d} value={d}>
                        {DIFFICULTY_LABELS[d]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="questionText">Question text</Label>
            <Textarea
              id="questionText"
              rows={4}
              disabled={!isEditable}
              value={questionText}
              onChange={(e) => {
                setQuestionText(e.target.value);
                queueSave({ questionText: e.target.value });
              }}
              placeholder="Supports LaTeX: $x^2$ inline, $$\frac{1}{2}$$ block"
            />
            <LatexHint />
            <UnderlineHint />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Question image (optional)</Label>
            <MediaUploadField
              kind="image"
              currentMediaId={questionImageId}
              currentUrl={mediaUrl(questionImageId)}
              onUploaded={(id) => {
                setQuestionImageId(id);
                queueSave({ questionImageId: id });
              }}
              onRemove={() => {
                setQuestionImageId(null);
                queueSave({ questionImageId: null });
              }}
              accept="image/png,image/jpeg,image/webp"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label>Calculator</Label>
              <p className="text-sm text-muted-foreground">
                {CALCULATOR_LABELS[calculatorSetting]}
                <span className="block text-xs">Determined by category — Desmos is allowed on all Math questions.</span>
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Suggested time</Label>
              <p className="text-sm text-muted-foreground">
                {suggestedTimeSeconds} seconds
                <span className="block text-xs">Determined by difficulty — Easy 60s, Medium 90s, Hard 180s.</span>
              </p>
            </div>
          </div>

          {question.questionType === "MULTIPLE_CHOICE" ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <Label>Answer choices</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!isEditable || explanationSteps.length === 0 || !choices.some((c) => c.isCorrect) || generatingDistractors}
                  onClick={() => void handleGenerateDistractors(explanationSteps.map((s) => s.text))}
                >
                  {generatingDistractors ? "Generating…" : "Generate distractor notes"}
                </Button>
              </div>
              <LatexHint />
              {choices.map((choice, index) => (
                <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="correctChoice"
                      aria-label={`Mark choice ${index + 1} as correct`}
                      disabled={!isEditable}
                      checked={choice.isCorrect}
                      onChange={() => {
                        const next = choices.map((c, i) => ({ ...c, isCorrect: i === index }));
                        setChoices(next);
                        queueSave({ answerChoices: next });
                      }}
                    />
                    <Label htmlFor={`choice-${index}`} className="sr-only">
                      Choice {index + 1}
                    </Label>
                    <Input
                      id={`choice-${index}`}
                      disabled={!isEditable}
                      value={choice.text}
                      placeholder={`Choice ${index + 1}`}
                      onChange={(e) => {
                        const next = choices.map((c, i) => (i === index ? { ...c, text: e.target.value } : c));
                        setChoices(next);
                        queueSave({ answerChoices: next });
                      }}
                    />
                  </div>
                  <MediaUploadField
                    kind="image"
                    currentMediaId={choice.imageId}
                    currentUrl={mediaUrl(choice.imageId)}
                    onUploaded={(id) => {
                      const next = choices.map((c, i) => (i === index ? { ...c, imageId: id } : c));
                      setChoices(next);
                      queueSave({ answerChoices: next });
                    }}
                    onRemove={() => {
                      const next = choices.map((c, i) => (i === index ? { ...c, imageId: null } : c));
                      setChoices(next);
                      queueSave({ answerChoices: next });
                    }}
                    accept="image/png,image/jpeg,image/webp"
                  />
                  {!choice.isCorrect && (
                    <div className="flex flex-col gap-1">
                      <Label htmlFor={`distractor-${index}`} className="text-xs text-muted-foreground">
                        Why students often pick this (shown only to a student who chooses it)
                      </Label>
                      <Textarea
                        id={`distractor-${index}`}
                        rows={2}
                        disabled={!isEditable}
                        value={choice.distractorExplanation ?? ""}
                        placeholder="e.g. You may have forgotten to convert units before comparing."
                        onChange={(e) => {
                          const value = e.target.value || null;
                          const next = choices.map((c, i) => (i === index ? { ...c, distractorExplanation: value } : c));
                          setChoices(next);
                          queueSave({ answerChoices: next });
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor="acceptedAnswers">Accepted answers (one per line)</Label>
              <Textarea
                id="acceptedAnswers"
                rows={3}
                disabled={!isEditable}
                value={acceptedAnswersText}
                onChange={(e) => {
                  setAcceptedAnswersText(e.target.value);
                  const answers = e.target.value
                    .split("\n")
                    .map((a) => a.trim())
                    .filter(Boolean);
                  queueSave({ acceptedAnswers: answers });
                }}
                placeholder={"0.5\n.5\n1/2"}
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="writtenExplanation">Written explanation (optional)</Label>
            <Textarea
              id="writtenExplanation"
              rows={3}
              disabled={!isEditable}
              value={writtenExplanation}
              onChange={(e) => {
                setWrittenExplanation(e.target.value);
                queueSave({ writtenExplanation: e.target.value || null });
              }}
            />
            <LatexHint />
            <p className="text-xs text-muted-foreground">
              Used as a fallback only when no step-by-step explanation exists below.
            </p>
          </div>

          {isEditable && (
            <div className="flex flex-col gap-3 rounded-lg border border-dashed border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Step-by-step explanation (optional)</p>
                  <p className="text-xs text-muted-foreground">
                    {canGenerateExplanation
                      ? "Generates a numbered walkthrough (text only). Replaces the steps below — review before saving. Add a diagram to an individual step afterward if it needs one."
                      : "Mark the correct answer (or enter an accepted answer) above first."}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!canGenerateExplanation || generatingExplanation}
                  onClick={() => void handleGenerateExplanation()}
                >
                  {generatingExplanation ? "Generating…" : explanationSteps.length > 0 ? "Regenerate" : "Generate"}
                </Button>
              </div>
              {generateExplanationError && (
                <Alert variant="destructive">
                  <AlertDescription>{generateExplanationError}</AlertDescription>
                </Alert>
              )}

              {explanationSteps.map((step, index) => (
                <div key={index} className="flex flex-col gap-2 rounded-md border border-border p-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`explanation-step-${index}`}>Step {index + 1}</Label>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const next = explanationSteps.filter((_, i) => i !== index);
                        setExplanationSteps(next);
                        queueSave({ explanationSteps: next });
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                  <Textarea
                    id={`explanation-step-${index}`}
                    rows={2}
                    value={step.text}
                    onChange={(e) => {
                      const next = explanationSteps.map((s, i) => (i === index ? { ...s, text: e.target.value } : s));
                      setExplanationSteps(next);
                      queueSave({ explanationSteps: next });
                    }}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-fit"
                    disabled={!step.text.trim() || generatingDiagramForStep !== null}
                    onClick={() => void handleGenerateStepDiagram(index)}
                  >
                    {generatingDiagramForStep === index
                      ? "Generating diagram…"
                      : step.imageId
                        ? "Regenerate diagram"
                        : "Generate diagram"}
                  </Button>
                  <MediaUploadField
                    kind="image"
                    currentMediaId={step.imageId}
                    currentUrl={mediaUrl(step.imageId)}
                    onUploaded={(id) => {
                      const next = explanationSteps.map((s, i) => (i === index ? { ...s, imageId: id } : s));
                      setExplanationSteps(next);
                      queueSave({ explanationSteps: next });
                    }}
                    onRemove={() => {
                      const next = explanationSteps.map((s, i) => (i === index ? { ...s, imageId: null } : s));
                      setExplanationSteps(next);
                      queueSave({ explanationSteps: next });
                    }}
                    accept="image/png,image/jpeg,image/webp"
                  />
                </div>
              ))}

              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="w-fit"
                onClick={() => {
                  const next = [...explanationSteps, { text: "", imageId: null }];
                  setExplanationSteps(next);
                  queueSave({ explanationSteps: next });
                }}
              >
                Add step
              </Button>
              <LatexHint />
            </div>
          )}

          {isFamilyMember ? (
            <Alert>
              <AlertDescription>
                The video explanation is shared by the whole family — manage it from the{" "}
                <Link href={`/owner/content/families/${question.familyId}`} className="underline">
                  Question Family page
                </Link>
                .
              </AlertDescription>
            </Alert>
          ) : (
            <div className="flex flex-col gap-2">
              <Label>Video explanation (optional)</Label>
              <MediaUploadField
                kind="video"
                currentMediaId={standaloneVideoId}
                currentUrl={mediaUrl(standaloneVideoId)}
                onUploaded={(id) => {
                  setStandaloneVideoId(id);
                  queueSave({ standaloneVideoId: id });
                }}
                onRemove={() => {
                  setStandaloneVideoId(null);
                  queueSave({ standaloneVideoId: null });
                }}
                accept="video/mp4,video/webm"
              />
            </div>
          )}

          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <Button variant="outline" onClick={openPreview}>
              Open Student Preview
            </Button>
            {canUnpublish && (
              <Button
                variant="outline"
                disabled={actionPending}
                onClick={() => runStatusAction(unpublishQuestionAction, "Question unpublished")}
              >
                Unpublish
              </Button>
            )}
            {canArchive && (
              <Button
                variant="outline"
                disabled={actionPending}
                onClick={() => runStatusAction(archiveQuestionAction, "Question archived")}
              >
                Archive
              </Button>
            )}
          </div>
        </div>

        {/* Read-only rendered preview of the current (saved) content */}
        <div className="flex flex-col gap-2">
          <Label>Preview</Label>
          <div className="rounded-lg border border-border p-4">
            <QuestionStatement
              text={questionText || "(no question text yet)"}
              imageId={questionImageId}
              mediaBasePath="/api/owner/media"
            />
            {question.questionType === "MULTIPLE_CHOICE" && (
              <div className="mt-4 flex flex-col gap-2">
                {choices.map((choice, i) => (
                  <div
                    key={i}
                    className={`rounded-md border p-2 text-sm ${choice.isCorrect ? "border-2 border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50" : "border-border"}`}
                  >
                    <LatexText text={choice.text || `Choice ${i + 1}`} />
                  </div>
                ))}
              </div>
            )}
            {explanationSteps.length > 0 ? (
              <div className="mt-4">
                <ExplanationSteps steps={explanationSteps} mediaBasePath="/api/owner/media" />
              </div>
            ) : (
              writtenExplanation && (
                <div className="mt-4 rounded-md bg-muted p-3 text-sm">
                  <LatexText text={writtenExplanation} />
                </div>
              )
            )}
          </div>

          {publishIssues.length > 0 && (
            <Alert>
              <AlertDescription>
                <p className="mb-1 font-medium">Not yet publishable:</p>
                <ul className="list-inside list-disc">
                  {publishIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
        </div>
      </div>

      <StudentPreviewSheet row={previewQuestion} open={previewOpen} onOpenChange={setPreviewOpen} />
    </div>
  );
}

// Reinforces the $...$ / $$...$$ convention (see latex-text.tsx) as a
// persistent caption rather than only a placeholder, which disappears the
// moment the field has content — confirmed via user report that typing bare
// "5x^2" (no delimiters) into the question text field silently rendered as
// literal text with no indication of why, once the placeholder was gone.
function LatexHint() {
  return (
    <p className="text-xs text-muted-foreground">
      Math must be wrapped in <code className="rounded bg-muted px-1 py-0.5">$...$</code> to render — e.g.{" "}
      <code className="rounded bg-muted px-1 py-0.5">$5x^2$</code>, not <code className="rounded bg-muted px-1 py-0.5">5x^2</code>.
    </p>
  );
}

// Same persistent-caption reasoning as LatexHint above — for questions that
// ask about "the underlined portion" (a common Reading & Writing format),
// without a visible caption an Owner has no way to discover this syntax
// exists at all, and the question is unanswerable to a student without it.
function UnderlineHint() {
  return (
    <p className="text-xs text-muted-foreground">
      Mark underlined text with <code className="rounded bg-muted px-1 py-0.5">[[...]]</code> — e.g.{" "}
      <code className="rounded bg-muted px-1 py-0.5">the [[underlined portion]] of the text</code>.
    </p>
  );
}

function SaveStatusIndicator({
  state,
  error,
  onRetry,
}: {
  state: SaveState;
  error: string | null;
  onRetry: () => void;
}) {
  if (state === "idle") return null;
  if (state === "unsaved") return <span className="text-sm text-muted-foreground">Unsaved changes</span>;
  if (state === "saving") return <span className="text-sm text-muted-foreground">Saving…</span>;
  if (state === "saved") return <span className="text-sm text-muted-foreground">Saved</span>;
  return (
    <span className="flex items-center gap-2 text-sm text-destructive">
      Save failed{error ? `: ${error}` : ""}
      <Button size="sm" variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </span>
  );
}
