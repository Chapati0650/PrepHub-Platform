"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { LatexText } from "@/components/content/latex-text";
import { MediaUploadField } from "../../media-upload-field";
import { StudentPreviewSheet } from "../../questions/student-preview-sheet";
import { CATEGORY_LABELS, DIFFICULTY_LABELS, STATUS_LABELS } from "@/lib/content/labels";
import { FAMILY_VERSION_COUNT } from "@/lib/content/constants";
import { getFamilyPublishIssues } from "@/lib/content/validation";
import type { QuestionFamilyWithContent } from "@/lib/content/families";
import type { QuestionListRow } from "@/lib/content/list-questions";
import {
  addVersionToFamilyAction,
  archiveFamilyAction,
  createVersionInFamilyAction,
  publishFamilyAction,
  restoreFamilyAction,
  setFamilyVideoAction,
  unpublishFamilyAction,
  updateFamilyDetailsAction,
} from "../../actions";

function mediaUrl(id: string | null | undefined): string | null {
  return id ? `/api/owner/media/${id}` : null;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" {
  if (status === "PUBLISHED") return "default";
  if (status === "ARCHIVED") return "destructive";
  return "secondary";
}

export function FamilyDetail({
  family,
  eligibleQuestions,
}: {
  family: QuestionFamilyWithContent;
  eligibleQuestions: QuestionListRow[];
}) {
  const router = useRouter();
  const [internalName, setInternalName] = useState(family.internalName ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [publishDialogOpen, setPublishDialogOpen] = useState(false);
  const [previewRow, setPreviewRow] = useState<QuestionListRow | null>(null);

  const issues = getFamilyPublishIssues(family);
  const isFull = family.questions.length >= FAMILY_VERSION_COUNT;
  const canPublish = family.status === "DRAFT" || family.status === "DRAFT_REVISION";
  const canUnpublish = family.status === "PUBLISHED" || family.status === "DRAFT_REVISION";
  const canArchive = family.status === "DRAFT";

  async function refresh() {
    router.refresh();
  }

  async function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    setPending(true);
    const result = await action();
    setPending(false);
    if (result.error) setError(result.error);
    else await refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href="/owner/content/families" className="text-sm underline">
          ← Question Families
        </Link>
        <Badge variant={statusVariant(family.status)}>{STATUS_LABELS[family.status]}</Badge>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-col gap-4 rounded-lg border border-border p-4">
        <div className="flex items-end gap-3">
          <div className="flex flex-1 flex-col gap-2">
            <Label htmlFor="internalName">Internal name</Label>
            <Input id="internalName" value={internalName} onChange={(e) => setInternalName(e.target.value)} />
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => run(() => updateFamilyDetailsAction(family.id, { internalName: internalName || undefined }))}
          >
            Save name
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          {CATEGORY_LABELS[family.category]} · {DIFFICULTY_LABELS[family.difficulty]} ·{" "}
          {family.questions.length} / {FAMILY_VERSION_COUNT} versions
        </p>

        <div className="flex flex-col gap-2">
          <Label>Shared video (required to publish)</Label>
          <MediaUploadField
            kind="video"
            currentMediaId={family.sharedVideoId}
            currentUrl={mediaUrl(family.sharedVideoId)}
            onUploaded={(id) => run(() => setFamilyVideoAction(family.id, id))}
            onRemove={() => run(() => setFamilyVideoAction(family.id, null))}
            accept="video/mp4,video/webm"
          />
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Versions</h2>
        {Array.from({ length: FAMILY_VERSION_COUNT }).map((_, index) => {
          const question = family.questions[index];
          if (!question) {
            return (
              <EmptyVersionSlot
                key={index}
                familyId={family.id}
                category={family.category}
                difficulty={family.difficulty}
                eligibleQuestions={eligibleQuestions}
                onChanged={refresh}
              />
            );
          }
          const revision = question.currentDraftRevision ?? question.currentPublishedRevision;
          return (
            <div key={question.id} className="flex items-center justify-between rounded-lg border border-border p-3">
              <div className="flex-1">
                <LatexText text={revision?.questionText || "(no question text yet)"} className="text-sm" />
                <Badge variant={statusVariant(question.status)} className="mt-1">
                  {STATUS_LABELS[question.status]}
                </Badge>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPreviewRow({ ...question, family } as QuestionListRow)}
                >
                  Preview
                </Button>
                <Link href={`/owner/content/questions/${question.id}`} className="text-sm underline">
                  Edit
                </Link>
              </div>
            </div>
          );
        })}
        {!isFull && (
          <p className="text-sm text-muted-foreground">{FAMILY_VERSION_COUNT - family.questions.length} version(s) missing.</p>
        )}
      </div>

      {issues.length > 0 && (
        <Alert>
          <AlertDescription>
            <p className="mb-1 font-medium">Not yet publishable:</p>
            <ul className="list-inside list-disc">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-4">
        {canPublish && (
          <Button disabled={pending} onClick={() => setPublishDialogOpen(true)}>
            {family.status === "DRAFT_REVISION" ? "Republish" : "Publish"}
          </Button>
        )}
        {canUnpublish && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => unpublishFamilyAction(family.id))}>
            Unpublish
          </Button>
        )}
        {canArchive && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => archiveFamilyAction(family.id))}>
            Archive
          </Button>
        )}
        {family.status === "ARCHIVED" && (
          <Button variant="outline" disabled={pending} onClick={() => run(() => restoreFamilyAction(family.id))}>
            Restore
          </Button>
        )}
      </div>

      <StudentPreviewSheet row={previewRow} open={previewRow !== null} onOpenChange={(open) => !open && setPreviewRow(null)} />

      <Dialog open={publishDialogOpen} onOpenChange={setPublishDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm family publish</DialogTitle>
            <DialogDescription>
              Publishes all {FAMILY_VERSION_COUNT} versions atomically. Existing Active Practice Sets are
              never affected.
            </DialogDescription>
          </DialogHeader>
          {issues.length > 0 && (
            <Alert variant="destructive">
              <AlertDescription>
                <ul className="list-inside list-disc">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button
              disabled={issues.length > 0 || pending}
              onClick={async () => {
                setPublishDialogOpen(false);
                await run(() => publishFamilyAction(family.id));
              }}
            >
              Confirm {family.status === "DRAFT_REVISION" ? "Republish" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyVersionSlot({
  familyId,
  category,
  difficulty,
  eligibleQuestions,
  onChanged,
}: {
  familyId: string;
  category: QuestionFamilyWithContent["category"];
  difficulty: QuestionFamilyWithContent["difficulty"];
  eligibleQuestions: QuestionListRow[];
  onChanged: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function createNewVersion() {
    setError(null);
    setPending(true);
    const result = await createVersionInFamilyAction(familyId, {
      questionType: "MULTIPLE_CHOICE",
      category,
      difficulty,
    });
    setPending(false);
    if (result.error) setError(result.error);
    else onChanged();
  }

  async function addExisting(questionId: string) {
    setError(null);
    setPending(true);
    const result = await addVersionToFamilyAction(familyId, questionId);
    setPending(false);
    setPickerOpen(false);
    if (result.error) setError(result.error);
    else onChanged();
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3">
      <p className="text-sm text-muted-foreground">Empty version slot</p>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={pending} onClick={createNewVersion}>
          Create new version
        </Button>
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <Button
            size="sm"
            variant="outline"
            render={
              <button type="button" onClick={() => setPickerOpen(true)}>
                Add existing question
              </button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add an existing question</DialogTitle>
              <DialogDescription>Only Draft questions with a matching category and difficulty.</DialogDescription>
            </DialogHeader>
            {eligibleQuestions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No eligible questions available.</p>
            ) : (
              <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {eligibleQuestions.map((q) => (
                  <button
                    key={q.id}
                    type="button"
                    disabled={pending}
                    onClick={() => addExisting(q.id)}
                    className="rounded-md border border-border p-2 text-left text-sm hover:bg-muted"
                  >
                    {q.currentDraftRevision?.questionText.trim() || "(no question text yet)"}
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
