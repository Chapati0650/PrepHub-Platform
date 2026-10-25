"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import {
  createAssignmentAction,
  pickRandomQuestionsAction,
  previewBankQuestionAction,
  searchQuestionBankAction,
} from "../../../../actions";
import type { BankFilters, BankItem, BankItemSummary } from "@/lib/teacher/question-bank";
import type { StudentQuestionContent, StudentQuestionFeedback } from "@/lib/session/question-content";
import { CATEGORY_LABELS, DIFFICULTY_LABELS, QUESTION_TYPE_LABELS } from "@/lib/content/labels";
import { LatexText } from "@/components/content/latex-text";
import { AnswerKey } from "@/components/teacher/answer-key";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";

type Results = { items: BankItem[]; total: number; page: number; pageCount: number };
type Preview = { content: StudentQuestionContent; feedback: StudentQuestionFeedback };

const ANY = "ANY";

/**
 * The bank on the left, the homework on the right. Every search, preview and
 * random pick is a server action called from an event handler, so nothing
 * here fetches in an effect (and the lint rule against setState in effects
 * has nothing to object to).
 */
export function AssignmentBuilder({
  classroomId,
  initialResults,
  maxQuestions,
}: {
  classroomId: string;
  initialResults: Results;
  maxQuestions: number;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<BankFilters>({});
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<Results>(initialResults);
  const [loading, startLoading] = useTransition();
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map());
  const [openPreview, setOpenPreview] = useState<string | null>(null);

  const [selected, setSelected] = useState<BankItemSummary[]>([]);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();

  const selectedIds = new Set(selected.map((q) => q.id));
  const full = selected.length >= maxQuestions;

  function runSearch(next: BankFilters, page = 1) {
    setFilters(next);
    startLoading(async () => {
      setResults(await searchQuestionBankAction(next, page));
    });
  }

  function togglePreview(id: string) {
    if (openPreview === id) return setOpenPreview(null);
    setOpenPreview(id);
    if (!previews.has(id)) {
      startLoading(async () => {
        const loaded = await previewBankQuestionAction(id);
        setPreviews((prev) => new Map(prev).set(id, loaded));
      });
    }
  }

  function add(item: BankItemSummary) {
    if (selectedIds.has(item.id) || full) return;
    setSelected((prev) => [...prev, item]);
  }

  function remove(id: string) {
    setSelected((prev) => prev.filter((q) => q.id !== id));
  }

  function move(index: number, delta: -1 | 1) {
    setSelected((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function addRandom(count: number) {
    startLoading(async () => {
      const picked = await pickRandomQuestionsAction(filters, Math.min(count, maxQuestions - selected.length), [...selectedIds]);
      setSelected((prev) => [...prev, ...picked.filter((p) => !prev.some((q) => q.id === p.id))].slice(0, maxQuestions));
    });
  }

  function submit() {
    setError(null);
    startSaving(async () => {
      const result = await createAssignmentAction(classroomId, {
        title,
        instructions,
        dueOn,
        questionIds: selected.map((q) => q.id),
      });
      if ("error" in result) {
        setError(result.error);
        return;
      }
      router.push(`/teacher/classes/${classroomId}/assignments/${result.assignmentId}`);
    });
  }

  const filterLabel = [
    filters.category && CATEGORY_LABELS[filters.category],
    filters.difficulty && DIFFICULTY_LABELS[filters.difficulty],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_22rem]">
      {/* ---- The bank ---- */}
      <section className="flex min-w-0 flex-col gap-4" aria-label="Question bank">
        <div className="grid gap-3 sm:grid-cols-3">
          <FilterSelect
            label="Category"
            value={filters.category ?? ANY}
            options={Object.entries(CATEGORY_LABELS)}
            onChange={(v) => runSearch({ ...filters, category: v === ANY ? undefined : (v as QuestionCategory) })}
          />
          <FilterSelect
            label="Difficulty"
            value={filters.difficulty ?? ANY}
            options={Object.entries(DIFFICULTY_LABELS)}
            onChange={(v) => runSearch({ ...filters, difficulty: v === ANY ? undefined : (v as QuestionDifficulty) })}
          />
          <FilterSelect
            label="Type"
            value={filters.questionType ?? ANY}
            options={Object.entries(QUESTION_TYPE_LABELS)}
            onChange={(v) => runSearch({ ...filters, questionType: v === ANY ? undefined : (v as QuestionType) })}
          />
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch({ ...filters, search: searchText.trim() || undefined });
          }}
          className="flex gap-2"
        >
          <Label htmlFor="bank-search" className="sr-only">
            Search question text
          </Label>
          <Input
            id="bank-search"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            placeholder="Search question text, e.g. “slope” or “transition”"
          />
          <Button type="submit" variant="outline" disabled={loading}>
            Search
          </Button>
        </form>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <p className="text-muted-foreground" aria-live="polite">
            {loading ? "Loading…" : `${results.total.toLocaleString()} question${results.total === 1 ? "" : "s"}`}
            {filterLabel && ` · ${filterLabel}`}
          </p>
          <div className="flex gap-2">
            {[5, 10].map((n) => (
              <Button
                key={n}
                variant="outline"
                size="sm"
                disabled={loading || full || results.total === 0}
                onClick={() => addRandom(n)}
              >
                Add {n} at random
              </Button>
            ))}
          </div>
        </div>

        {results.items.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-5 text-sm text-muted-foreground">
            No published questions match. Try a different category or difficulty, or clear the search.
          </p>
        ) : (
          <ul className="divide-y divide-border border-y border-border">
            {results.items.map((item) => {
              const added = selectedIds.has(item.id);
              const preview = previews.get(item.id);
              return (
                <li key={item.id} className="py-3">
                  <div className="flex items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        {CATEGORY_LABELS[item.category]} · {DIFFICULTY_LABELS[item.difficulty]} ·{" "}
                        {QUESTION_TYPE_LABELS[item.questionType]}
                        {item.hasPassage && " · with passage"}
                      </p>
                      <div className="mt-1 line-clamp-3 text-sm">
                        <LatexText text={item.snippet} />
                      </div>
                      <button
                        type="button"
                        onClick={() => togglePreview(item.id)}
                        aria-expanded={openPreview === item.id}
                        className="mt-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {openPreview === item.id ? "Hide answer key" : "Preview with answer key"}
                      </button>
                    </div>
                    <Button
                      size="sm"
                      variant={added ? "secondary" : "outline"}
                      disabled={!added && full}
                      onClick={() => (added ? remove(item.id) : add(item))}
                      aria-pressed={added}
                      className="shrink-0"
                    >
                      {added ? "Added" : "Add"}
                    </Button>
                  </div>
                  {openPreview === item.id && (
                    <div className="mt-3 rounded-xl border border-border p-4">
                      {preview ? <AnswerKey content={preview.content} feedback={preview.feedback} /> : <p className="text-sm text-muted-foreground">Loading…</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {results.pageCount > 1 && (
          <div className="flex items-center justify-between text-sm">
            <Button
              variant="outline"
              size="sm"
              disabled={loading || results.page <= 1}
              onClick={() => runSearch(filters, results.page - 1)}
            >
              Previous
            </Button>
            <span className="text-muted-foreground tabular-nums">
              Page {results.page} of {results.pageCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={loading || results.page >= results.pageCount}
              onClick={() => runSearch(filters, results.page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </section>

      {/* ---- The homework ---- */}
      <aside className="flex flex-col gap-4 rounded-2xl border border-border p-5 lg:sticky lg:top-6" aria-label="This homework">
        <div className="flex flex-col gap-2">
          <Label htmlFor="hw-title">Title</Label>
          <Input id="hw-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Linear equations warm-up" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hw-due">Due (optional)</Label>
          <Input id="hw-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="w-fit" />
          <p className="text-xs text-muted-foreground">Due at the end of that day, Central time. Late work is still accepted and marked late.</p>
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hw-instructions">Instructions (optional)</Label>
          <Textarea
            id="hw-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            maxLength={2000}
            rows={3}
            placeholder="e.g. Show your work on paper — we'll go over #4 in class."
          />
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">
            Questions <span className="text-muted-foreground tabular-nums">· {selected.length}/{maxQuestions}</span>
          </p>
          {selected.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add questions from the bank.</p>
          ) : (
            <ol className="flex max-h-[40vh] flex-col divide-y divide-border overflow-y-auto border-y border-border">
              {selected.map((q, i) => (
                <li key={q.id} className="flex items-start gap-2 py-2 text-sm">
                  <span className="w-6 shrink-0 font-heading font-semibold tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs text-muted-foreground">
                      {CATEGORY_LABELS[q.category]} · {DIFFICULTY_LABELS[q.difficulty]}
                    </span>
                    <span className="line-clamp-2">
                      <LatexText text={q.snippet} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col">
                    <button type="button" aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ArrowUp className="size-3.5" aria-hidden />
                    </button>
                    <button type="button" aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === selected.length - 1} className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-30">
                      <ArrowDown className="size-3.5" aria-hidden />
                    </button>
                  </span>
                  <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => remove(q.id)} className="rounded p-0.5 text-muted-foreground hover:text-destructive">
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        <Button size="cta" onClick={submit} disabled={saving || selected.length === 0 || !title.trim()}>
          {saving ? "Assigning…" : "Assign to class"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Students see it on their Homework page as soon as you assign it.
        </p>
      </aside>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: [string, string][];
  onChange: (value: string) => void;
}) {
  const id = `filter-${label.toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v ?? ANY)}>
        <SelectTrigger id={id} className="w-full">
          {/* Base UI shows the raw value unless told the label (the same
              mapping the question editor uses). */}
          <SelectValue>{(v: string) => (v === ANY ? "Any" : (options.find(([key]) => key === v)?.[1] ?? v))}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>Any</SelectItem>
          {options.map(([v, l]) => (
            <SelectItem key={v} value={v}>
              {l}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
