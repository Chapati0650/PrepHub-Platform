"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { FAMILY_ELIGIBLE_CATEGORIES, DIFFICULTY_ORDER } from "@/lib/content/constants";
import { CATEGORY_LABELS, DIFFICULTY_LABELS } from "@/lib/content/labels";
import type { QuestionCategory, QuestionDifficulty } from "@/generated/prisma/client";
import { createEmptyFamilyAction } from "../actions";

// PRD-015 §8.3 "Create an empty family."
export function CreateFamilyDialog() {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<QuestionCategory>(FAMILY_ELIGIBLE_CATEGORIES[0]);
  const [difficulty, setDifficulty] = useState<QuestionDifficulty>("MEDIUM");
  const [internalName, setInternalName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleCreate() {
    setError(null);
    startTransition(async () => {
      try {
        await createEmptyFamilyAction({ category, difficulty, internalName: internalName || undefined });
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
            Create Family
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a Question Family</DialogTitle>
          <DialogDescription>
            Only Algebra, Geometry &amp; Trig, Advanced Math, and Problem Solving &amp; Data Analysis
            questions can belong to a family. Add up to 3 versions afterward.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="familyName">Internal name (optional)</Label>
            <Input
              id="familyName"
              value={internalName}
              onChange={(e) => setInternalName(e.target.value)}
              placeholder="e.g. Linear equations — one variable"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="familyCategory">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as QuestionCategory)}>
              <SelectTrigger id="familyCategory">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FAMILY_ELIGIBLE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="familyDifficulty">Difficulty</Label>
            <Select value={difficulty} onValueChange={(v) => setDifficulty(v as QuestionDifficulty)}>
              <SelectTrigger id="familyDifficulty">
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
            {isPending ? "Creating..." : "Create Family"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
