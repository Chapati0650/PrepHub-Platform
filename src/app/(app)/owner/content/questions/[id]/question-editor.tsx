"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LatexText } from "@/components/content/latex-text";
import { getPublishIssues, type RevisionForValidation } from "@/lib/content/validation";
import { CATEGORY_LABELS, DIFFICULTY_LABELS, STATUS_LABELS } from "@/lib/content/labels";
import type { QuestionContentPatch, QuestionWithContent } from "@/lib/content/questions";
import type { MediaAsset } from "@/generated/prisma/client";
import { MediaUploadField } from "../../media-upload-field";
import { StudentPreviewSheet } from "../student-preview-sheet";
import {
  archiveQuestionAction,
  getQuestionAction,
  markPreviewCompletedAction,
  publishQuestionAction,
  restoreQuestionAction,
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

export function QuestionEditor({ question: initialQuestion }: { question: QuestionWithContent }) {
  const router = useRouter();
  const [question, setQuestion] = useState(initialQuestion);
  const revision = question.currentDraftRevision ?? question.currentPublishedRevision!;
  const isFamilyMember = question.familyId !== null;
  const isArchived = question.status === "ARCHIVED";
  const isEditable = !isArchived;

  const [questionText, setQuestionText] = useState(revision.questionText);
  const [calculatorSetting, setCalculatorSetting] = useState(revision.calculatorSetting);
  const [suggestedTimeSeconds, setSuggestedTimeSeconds] = useState(revision.suggestedTimeSeconds);
  const [writtenExplanation, setWrittenExplanation] = useState(revision.writtenExplanation ?? "");
  const [acceptedAnswersText, setAcceptedAnswersText] = useState(revision.acceptedAnswers.join("\n"));
  const [choices, setChoices] = useState(
    revision.answerChoices.length === 4
      ? revision.answerChoices.map((c) => ({ text: c.text, isCorrect: c.isCorrect, imageId: c.imageId as string | null }))
      : Array.from({ length: 4 }, () => ({ text: "", isCorrect: false, imageId: null as string | null })),
  );
  const [questionImageId, setQuestionImageId] = useState<string | null>(revision.questionImageId);
  const [standaloneVideoId, setStandaloneVideoId] = useState<string | null>(revision.standaloneVideoId);

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewQuestion, setPreviewQuestion] = useState(initialQuestion);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);

  const pendingPatch = useRef<QuestionContentPatch>({});
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // A save can silently flip status (e.g. editing a Published question
    // starts a Draft Revision) — refresh so the badge/action buttons stay truthful.
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

  async function runStatusAction(action: (id: string) => Promise<{ error?: string }>) {
    setActionError(null);
    setActionPending(true);
    const result = await action(question.id);
    setActionPending(false);
    if (result.error) {
      setActionError(result.error);
      return;
    }
    await refreshQuestion();
    router.refresh();
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
          <Link href="/owner/content/questions" className="text-sm underline">
            ← Questions
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
        <SaveStatusIndicator state={saveState} error={saveError} onRetry={() => void flush()} />
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {isArchived && (
        <Alert>
          <AlertDescription>
            This question is archived and read-only.{" "}
            <button className="underline" onClick={() => runStatusAction(restoreQuestionAction)}>
              Restore it
            </button>{" "}
            to edit again.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Editable form */}
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1">
              <Label>Category</Label>
              <p className="text-sm text-muted-foreground">
                {CATEGORY_LABELS[question.category]}
                {isFamilyMember && " (set by the family)"}
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Difficulty</Label>
              <p className="text-sm text-muted-foreground">
                {DIFFICULTY_LABELS[question.difficulty]}
                {isFamilyMember && " (set by the family)"}
              </p>
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="calculatorSetting">Calculator</Label>
              <Select
                value={calculatorSetting}
                onValueChange={(v) => {
                  const value = v as "ALLOWED" | "NOT_ALLOWED";
                  setCalculatorSetting(value);
                  queueSave({ calculatorSetting: value });
                }}
              >
                <SelectTrigger id="calculatorSetting" disabled={!isEditable}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALLOWED">Calculator Allowed</SelectItem>
                  <SelectItem value="NOT_ALLOWED">Calculator Not Allowed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="suggestedTime">Suggested time (seconds)</Label>
              <Input
                id="suggestedTime"
                type="number"
                min={1}
                disabled={!isEditable}
                value={suggestedTimeSeconds}
                onChange={(e) => {
                  const value = Number(e.target.value) || 0;
                  setSuggestedTimeSeconds(value);
                  queueSave({ suggestedTimeSeconds: value });
                }}
              />
            </div>
          </div>

          {question.questionType === "MULTIPLE_CHOICE" ? (
            <div className="flex flex-col gap-3">
              <Label>Answer choices</Label>
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
          </div>

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
              <Label>Video explanation (required to publish)</Label>
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
            {canPublish && (
              <Button
                disabled={actionPending}
                onClick={async () => {
                  await flush();
                  await refreshQuestion();
                  setPublishDialogOpen(true);
                }}
              >
                {question.status === "DRAFT_REVISION" ? "Republish" : "Publish"}
              </Button>
            )}
            {canUnpublish && (
              <Button variant="outline" disabled={actionPending} onClick={() => runStatusAction(unpublishQuestionAction)}>
                Unpublish
              </Button>
            )}
            {canArchive && (
              <Button variant="outline" disabled={actionPending} onClick={() => runStatusAction(archiveQuestionAction)}>
                Archive
              </Button>
            )}
          </div>
        </div>

        {/* Read-only rendered preview of the current (saved) content */}
        <div className="flex flex-col gap-2">
          <Label>Preview</Label>
          <div className="rounded-lg border border-border p-4">
            <LatexText text={questionText || "(no question text yet)"} className="text-base" />
            {questionImageId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={mediaUrl(questionImageId)!} alt="" className="mt-3 max-w-full rounded" />
            )}
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
            {writtenExplanation && (
              <div className="mt-4 rounded-md bg-muted p-3 text-sm">
                <LatexText text={writtenExplanation} />
              </div>
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

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm publish</DialogTitle>
            <DialogDescription>
              This makes the question eligible for new diagnostics and practice sets. Existing Active
              Practice Sets are never affected.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1 text-sm">
            <p>
              <span className="text-muted-foreground">Category:</span> {CATEGORY_LABELS[question.category]}
            </p>
            <p>
              <span className="text-muted-foreground">Difficulty:</span> {DIFFICULTY_LABELS[question.difficulty]}
            </p>
            <p>
              <span className="text-muted-foreground">Correct answer:</span>{" "}
              {question.questionType === "MULTIPLE_CHOICE"
                ? (choices.find((c) => c.isCorrect)?.text ?? "None selected")
                : acceptedAnswersText.split("\n")[0]}
            </p>
          </div>
          {publishIssues.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {publishIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              disabled={publishIssues.length > 0 || actionPending}
              onClick={async () => {
                setPublishDialogOpen(false);
                await runStatusAction(publishQuestionAction);
              }}
            >
              Confirm {question.status === "DRAFT_REVISION" ? "Republish" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
