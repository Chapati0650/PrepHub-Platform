"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@/lib/content/labels";
import { FAMILY_VERSION_COUNT } from "@/lib/content/constants";
import type { QuestionListRow } from "@/lib/content/list-questions";
import { groupExistingQuestionsAction } from "../actions";

// PRD-015 §8.3 "Group existing questions." Blocking rules (mismatched
// category/difficulty, already-full selection) are enforced authoritatively
// server-side; here we just keep the picker usable.
export function GroupQuestionsDialog({ eligibleQuestions }: { eligibleQuestions: QuestionListRow[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [internalName, setInternalName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) {
        if (next.size >= FAMILY_VERSION_COUNT) return prev;
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      try {
        await groupExistingQuestionsAction({
          questionIds: Array.from(selected),
          internalName: internalName || undefined,
        });
      } catch (err) {
        if (err instanceof Error && err.message !== "NEXT_REDIRECT") setError(err.message);
        else if (!(err instanceof Error)) throw err;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        render={
          <button type="button" onClick={() => setOpen(true)}>
            Group Existing Questions
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Group existing questions into a family</DialogTitle>
          <DialogDescription>
            Select 1–{FAMILY_VERSION_COUNT} Draft math questions that share the same category and
            difficulty.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="groupFamilyName">Internal name (optional)</Label>
            <Input id="groupFamilyName" value={internalName} onChange={(e) => setInternalName(e.target.value)} />
          </div>

          {eligibleQuestions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No eligible Draft math questions available. Create some first.
            </p>
          ) : (
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
              {eligibleQuestions.map((q) => {
                const revision = q.currentDraftRevision;
                const label = revision?.questionText.trim() || "(no question text yet)";
                return (
                  <label key={q.id} className="flex items-center gap-2 rounded-md border border-border p-2 text-sm">
                    <Checkbox
                      checked={selected.has(q.id)}
                      onCheckedChange={(checked) => toggle(q.id, checked === true)}
                    />
                    <span className="flex-1 truncate">{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[q.category]} · {DIFFICULTY_LABELS[q.difficulty]}
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          <Button onClick={handleSubmit} disabled={isPending || selected.size === 0}>
            {isPending ? "Grouping..." : `Group ${selected.size} question(s)`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
