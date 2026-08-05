"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/dialog";
import { CATEGORY_ORDER, DIFFICULTY_ORDER } from "@/lib/content/constants";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@/lib/content/labels";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { createQuestionAction } from "../actions";

// PRD-015 §6.1: the Owner picks a type up front; we also collect
// category/difficulty here (see questions.ts's createQuestion doc comment)
// so the Questions table's denormalized filter columns are never null.
export function CreateQuestionDialog() {
  const [open, setOpen] = useState(false);
  const [questionType, setQuestionType] = useState<QuestionType>("MULTIPLE_CHOICE");
  const [category, setCategory] = useState<QuestionCategory>("ALGEBRA");
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>("MEDIUM");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        await createQuestionAction({ questionType, category, difficulty });
      } catch (err) {
        // createQuestionAction redirects on success, which surfaces as a thrown
        // NEXT_REDIRECT — only report genuine failures.
        if (err instanceof Error && err.message !== "NEXT_REDIRECT") setError(err.message);
        else if (!(err instanceof Error)) throw err;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Create Question
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a question</DialogTitle>
          <DialogDescription>
            Choose the question type, category, and difficulty. Everything else is filled in on the
            next screen.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="questionType">Question type</Label>
            <Select value={questionType} onValueChange={(v) => setQuestionType(v as QuestionType)}>
              <SelectTrigger id="questionType">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MULTIPLE_CHOICE">Multiple Choice</SelectItem>
                <SelectItem value="OPEN_ENDED_NUMERIC">Open-Ended Numeric Response</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="createQuestionCategory">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as QuestionCategory)}>
              <SelectTrigger id="createQuestionCategory">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="createQuestionDifficulty">Difficulty</Label>
            <Select value={difficulty} onValueChange={(v) => setDifficulty(v as QuestionDifficulty)}>
              <SelectTrigger id="createQuestionDifficulty">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIFFICULTY_ORDER.map((d) => (
                  <SelectItem key={d} value={d}>
                    {DIFFICULTY_LABELS[d]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleCreate} disabled={isPending}>
            {isPending ? "Creating..." : "Create Question"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
