"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import type { QuestionCategory, QuestionDifficulty, QuestionType } from "@/generated/prisma/client";
import { ActionFailureNote, actionFailure, type ActionFailure } from "@/components/staff/action-failure";
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
type Mode = "PRACTICE" | "QUIZ";

const ANY = "ANY";

const MODES: { value: Mode; title: string; body: string }[] = [
  { value: "PRACTICE", title: "Practice", body: "Students see right or wrong, and the explanation, after each answer." },
  { value: "QUIZ", title: "Quiz", body: "Nothing is shown until they turn it in; then they see every answer and explanation." },
];

// ---- The draft, kept in this browser ------------------------------------------
//
// A teacher can spend twenty minutes choosing questions, so what they've built
// is kept in localStorage per class until it's assigned: a reload, a stale
// page after a deploy, or a closed tab no longer throws it away. Only here,
// not on the server — a half-built homework is nobody else's business — and
// every access is wrapped, because school Chromebooks can block storage.

type Draft = {
  savedAt: number;
  selected: BankItemSummary[];
  title: string;
  instructions: string;
  dueOn: string;
  mode: Mode;
  alsoClasses: string[];
};

const DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const draftKey = (classroomId: string) => `prephub:homework-draft:${classroomId}`;

function isSummary(value: unknown): value is BankItemSummary {
  if (!value || typeof value !== "object") return false;
  const q = value as Record<string, unknown>;
  return (
    typeof q.id === "string" &&
    typeof q.snippet === "string" &&
    typeof q.category === "string" &&
    q.category in CATEGORY_LABELS &&
    typeof q.difficulty === "string" &&
    q.difficulty in DIFFICULTY_LABELS &&
    typeof q.questionType === "string" &&
    (q.passageSnippet === null || typeof q.passageSnippet === "string")
  );
}

/** The saved draft, checked field by field (it came from storage), or null. */
function readDraft(classroomId: string, maxQuestions: number): Draft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(classroomId));
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.savedAt !== "number" || Date.now() - d.savedAt > DRAFT_MAX_AGE_MS) return null;
    return {
      savedAt: d.savedAt,
      selected: Array.isArray(d.selected) ? d.selected.filter(isSummary).slice(0, maxQuestions) : [],
      title: typeof d.title === "string" ? d.title : "",
      instructions: typeof d.instructions === "string" ? d.instructions : "",
      dueOn: typeof d.dueOn === "string" ? d.dueOn : "",
      mode: d.mode === "QUIZ" ? "QUIZ" : "PRACTICE",
      alsoClasses: Array.isArray(d.alsoClasses) ? d.alsoClasses.filter((id): id is string => typeof id === "string") : [],
    };
  } catch {
    return null;
  }
}

function writeDraft(classroomId: string, draft: Omit<Draft, "savedAt">) {
  try {
    const empty = draft.selected.length === 0 && !draft.title.trim() && !draft.instructions.trim() && !draft.dueOn;
    if (empty) window.localStorage.removeItem(draftKey(classroomId));
    else window.localStorage.setItem(draftKey(classroomId), JSON.stringify({ ...draft, savedAt: Date.now() }));
  } catch {
    // Storage full or blocked: the builder still works, it just won't survive a reload.
  }
}

function clearDraft(classroomId: string) {
  try {
    window.localStorage.removeItem(draftKey(classroomId));
  } catch {
    // As above.
  }
}

const noSubscription = () => () => {};

/**
 * The bank on the left, the homework on the right. Every search, preview and
 * random pick is a server action called from an event handler, so nothing
 * here fetches in an effect (and the lint rule against setState in effects
 * has nothing to object to). Each call is caught: a failure says so where it
 * happened and never takes the page — and the teacher's chosen questions —
 * with it.
 */
export function AssignmentBuilder({
  classroomId,
  className,
  otherClasses,
  initialResults,
  maxQuestions,
}: {
  classroomId: string;
  className: string;
  /** The teacher's other open classes, offered as "also assign to". */
  otherClasses: { id: string; name: string }[];
  initialResults: Results;
  maxQuestions: number;
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<BankFilters>({});
  const [searchText, setSearchText] = useState("");
  const [results, setResults] = useState<Results>(initialResults);
  // Three separate transitions: a shared one made the "Loading…" label next to
  // "Add 5 at random" show for a question preview (or an add-at-random) while
  // the list below was already populated. Only a search is "Loading…".
  const [searching, startSearching] = useTransition();
  const [adding, startAdding] = useTransition();
  const [, startPreviewing] = useTransition();
  const loading = searching || adding;
  const [previews, setPreviews] = useState<Map<string, Preview>>(new Map());
  const [openPreview, setOpenPreview] = useState<string | null>(null);
  // With the call to retry, so "Try again" repeats what failed.
  const [bankFailure, setBankFailure] = useState<{ failure: ActionFailure; retry: () => void } | null>(null);
  const [previewFailure, setPreviewFailure] = useState<{ id: string; failure: ActionFailure } | null>(null);

  const [selected, setSelected] = useState<BankItemSummary[]>([]);
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [dueOn, setDueOn] = useState("");
  const [mode, setMode] = useState<Mode>("PRACTICE");
  const [alsoClasses, setAlsoClasses] = useState<Set<string>>(new Set());

  // On large screens the panel is as tall as the room below its top edge, so the
  // Assign button is on screen even before the page is scrolled (the panel sits
  // under the page header there; a fixed viewport-tall cap pushed its bottom off
  // screen until the page had scrolled). Once the panel sticks at 1.5rem it is
  // the full height minus 3rem.
  const panelRef = useRef<HTMLElement>(null);
  // "More above / below" cue for the panel's inner scroll area; shown only
  // while there is something to scroll to.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState({ up: false, down: false });
  // Fades the edges that have more content; on small screens the panel doesn't
  // scroll on its own, so the mask only applies at lg and up (see the class).
  const fadeMask =
    more.up || more.down
      ? {
          WebkitMaskImage: `linear-gradient(to bottom, ${more.up ? "transparent, black 2rem" : "black, black"}, ${more.down ? "black calc(100% - 3rem), transparent" : "black, black"})`,
          maskImage: `linear-gradient(to bottom, ${more.up ? "transparent, black 2rem" : "black, black"}, ${more.down ? "black calc(100% - 3rem), transparent" : "black, black"})`,
        }
      : undefined;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const update = () => {
      const up = el.scrollTop > 4;
      const down = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
      setMore((m) => (m.up === up && m.down === down ? m : { up, down }));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const wide = window.matchMedia("(min-width: 1024px)");
    let frame = 0;
    const fit = () => {
      frame = 0;
      if (!wide.matches) {
        el.style.maxHeight = "";
        return;
      }
      const margin = 24;
      const top = Math.max(el.getBoundingClientRect().top, margin);
      el.style.maxHeight = `${Math.max(320, window.innerHeight - top - margin)}px`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, []);

  // The saved draft exists only in the browser, so the server's render and
  // hydration are the empty builder, and the draft is read in on the first
  // render after (useSyncExternalStore: false on the server, true in the
  // browser — the theme toggle's pattern). It's applied by adjusting state
  // during that render, not in an effect and not by remounting: React replays
  // a click that landed during hydration on this instance, and a remount had
  // thrown away whatever that click did ("Add 5 at random" adding nothing).
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  const [draftRead, setDraftRead] = useState(false);
  const [restored, setRestored] = useState(false);
  if (inBrowser && !draftRead) {
    setDraftRead(true);
    const draft = readDraft(classroomId, maxQuestions);
    if (draft) {
      setSelected(draft.selected);
      setTitle(draft.title);
      setInstructions(draft.instructions);
      setDueOn(draft.dueOn);
      setMode(draft.mode);
      // A class archived since the draft was saved is simply no longer offered.
      setAlsoClasses(new Set(draft.alsoClasses.filter((id) => otherClasses.some((c) => c.id === id))));
      setRestored(true);
    }
  }
  const [error, setError] = useState<string | null>(null);
  const [submitFailure, setSubmitFailure] = useState<ActionFailure | null>(null);
  const [saving, startSaving] = useTransition();
  // Stays true from the click until the page changes. `saving` alone ends the
  // moment router.push is called, so during a slow navigation the button came
  // back and a second press assigned the same homework twice.
  const [submitted, setSubmitted] = useState(false);
  const [randomNotice, setRandomNotice] = useState<string | null>(null);

  const selectedIds = new Set(selected.map((q) => q.id));
  const full = selected.length >= maxQuestions;
  const classCount = 1 + alsoClasses.size;

  // Writes only once the draft has been read (before that, this would save an
  // empty builder over it), and not once the homework has been assigned.
  useEffect(() => {
    if (!draftRead || submitted) return;
    writeDraft(classroomId, { selected, title, instructions, dueOn, mode, alsoClasses: [...alsoClasses] });
  }, [draftRead, submitted, classroomId, selected, title, instructions, dueOn, mode, alsoClasses]);

  function startOver() {
    setSelected([]);
    setTitle("");
    setInstructions("");
    setDueOn("");
    setMode("PRACTICE");
    setAlsoClasses(new Set());
    setRestored(false);
    clearDraft(classroomId);
  }

  function runSearch(next: BankFilters, page = 1) {
    setFilters(next);
    setRandomNotice(null);
    setBankFailure(null);
    startSearching(async () => {
      try {
        setResults(await searchQuestionBankAction(classroomId, next, page));
      } catch (err) {
        setBankFailure({
          failure: actionFailure(err, "Couldn't load questions just now. Your homework so far is kept; try again."),
          retry: () => runSearch(next, page),
        });
      }
    });
  }

  function loadPreview(id: string) {
    setPreviewFailure(null);
    startPreviewing(async () => {
      try {
        const loaded = await previewBankQuestionAction(id);
        setPreviews((prev) => new Map(prev).set(id, loaded));
      } catch (err) {
        setPreviewFailure({
          id,
          failure: actionFailure(
            err,
            "Couldn't open this question. It may have just been taken out of the bank; try again.",
          ),
        });
      }
    });
  }

  function togglePreview(id: string) {
    if (openPreview === id) return setOpenPreview(null);
    setOpenPreview(id);
    if (!previews.has(id)) loadPreview(id);
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

  function toggleAlso(id: string) {
    setAlsoClasses((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Says what actually happened: a small pool or a nearly full homework can
  // add fewer than asked, or none, which otherwise looks like a broken button.
  function addRandom(count: number) {
    const wanted = Math.min(count, maxQuestions - selected.length);
    setRandomNotice(null);
    setBankFailure(null);
    startAdding(async () => {
      let picked: Awaited<ReturnType<typeof pickRandomQuestionsAction>>;
      try {
        picked = await pickRandomQuestionsAction(classroomId, filters, wanted, [...selectedIds]);
      } catch (err) {
        setBankFailure({
          failure: actionFailure(err, "Couldn't add questions just now. Your homework so far is kept; try again."),
          retry: () => addRandom(count),
        });
        return;
      }
      const fresh = picked.filter((p) => !selectedIds.has(p.id)).slice(0, wanted);
      setSelected((prev) => [...prev, ...fresh.filter((p) => !prev.some((q) => q.id === p.id))].slice(0, maxQuestions));
      const filtered = Boolean(filters.category || filters.difficulty || filters.questionType || filters.search || filters.hideAssigned);
      const which = filtered ? "matching these filters" : "in the bank";
      const repeats = fresh.filter((p) => p.assignedIn.length > 0).length;
      const repeatNote = repeats > 0 ? ` ${repeats} of them this class has had before.` : "";
      if (fresh.length === 0) {
        setRandomNotice(`Every question ${which} is already on this homework.`);
      } else if (fresh.length < wanted) {
        setRandomNotice(
          `Added ${fresh.length} — that's every question ${which} not already on this homework.${filtered ? " Change the filters to add more." : ""}${repeatNote}`,
        );
      } else if (wanted < count) {
        setRandomNotice(`Added ${fresh.length}. That fills the homework: it can have up to ${maxQuestions} questions.${repeatNote}`);
      } else {
        setRandomNotice(`Added ${fresh.length} question${fresh.length === 1 ? "" : "s"}.${repeatNote}`);
      }
    });
  }

  function submit() {
    if (submitted) return;
    setError(null);
    setSubmitFailure(null);
    setSubmitted(true);
    startSaving(async () => {
      let result: Awaited<ReturnType<typeof createAssignmentAction>>;
      try {
        result = await createAssignmentAction(classroomId, {
          title,
          instructions,
          dueOn,
          questionIds: selected.map((q) => q.id),
          mode,
          alsoClassroomIds: [...alsoClasses],
        });
      } catch (err) {
        // Not "nothing was assigned": the request may have landed before the
        // connection dropped, so the teacher is sent to look before retrying.
        setSubmitFailure(
          actionFailure(
            err,
            "Couldn't confirm the homework was assigned. Check the class page before trying again, so it isn't assigned twice. Your questions are kept here.",
          ),
        );
        setSubmitted(false);
        return;
      }
      if ("error" in result) {
        setError(result.error);
        setSubmitted(false);
        return;
      }
      clearDraft(classroomId);
      const notice = result.classCount > 1 ? `?assigned=${result.classCount}` : "";
      router.push(`/teacher/classes/${classroomId}/assignments/${result.assignmentId}${notice}`);
    });
  }

  const filterLabel = [
    filters.category && CATEGORY_LABELS[filters.category],
    filters.difficulty && DIFFICULTY_LABELS[filters.difficulty],
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="grid items-start gap-8 lg:grid-cols-[1fr_24rem]">
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
            className="h-11 text-base md:text-base"
          />
          <Button type="submit" variant="outline" size="xl" disabled={loading}>
            Search
          </Button>
        </form>
        <label className="flex w-fit items-center gap-2.5 text-base">
          <input
            type="checkbox"
            checked={filters.hideAssigned === true}
            onChange={(e) => runSearch({ ...filters, hideAssigned: e.target.checked || undefined })}
            className="size-4.5 accent-primary"
          />
          Hide questions {className} has already had
        </label>

        <div className="flex flex-wrap items-center justify-between gap-2 text-base">
          <p className="text-muted-foreground" aria-live="polite">
            {searching ? "Loading…" : adding ? "Adding…" : `${results.total.toLocaleString()} question${results.total === 1 ? "" : "s"}`}
            {filterLabel && ` · ${filterLabel}`}
          </p>
          <div className="flex gap-2">
            {[5, 10].map((n) => (
              <Button
                key={n}
                variant="outline"
                size="lg"
                disabled={loading || full || results.total === 0}
                onClick={() => addRandom(n)}
              >
                Add {n} at random
              </Button>
            ))}
          </div>
        </div>
        {randomNotice && (
          <p role="status" className="text-base text-muted-foreground">
            {randomNotice}
          </p>
        )}
        {bankFailure && <ActionFailureNote failure={bankFailure.failure} onRetry={bankFailure.retry} />}

        {results.items.length === 0 ? (
          <p className="rounded-2xl bg-surface-tint p-5 text-base text-muted-foreground">
            {filters.hideAssigned
              ? `No published questions match that ${className} hasn't already had. Try another category or difficulty, or show the ones it has had.`
              : "No published questions match. Try a different category or difficulty, or clear the search."}
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
                      <p className="text-sm text-muted-foreground">
                        {CATEGORY_LABELS[item.category]} · {DIFFICULTY_LABELS[item.difficulty]} ·{" "}
                        {QUESTION_TYPE_LABELS[item.questionType]}
                      </p>
                      {/* The passage first: Reading and Writing stems repeat, so it's
                          the passage that tells one question from the next. */}
                      {item.passageSnippet && (
                        <div className="mt-1 line-clamp-2 border-l-2 border-border pl-2.5 text-sm text-muted-foreground">
                          <LatexText text={item.passageSnippet} />
                        </div>
                      )}
                      <div className="mt-1 line-clamp-3 text-base">
                        <LatexText text={item.snippet} />
                      </div>
                      {item.assignedIn.length > 0 && (
                        <p className="mt-1 text-sm font-medium text-amber-800 dark:text-amber-300">
                          Already assigned in {item.assignedIn.map((t) => `“${t}”`).join(", ")}
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => togglePreview(item.id)}
                        aria-expanded={openPreview === item.id}
                        className="mt-1 text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        {openPreview === item.id ? "Hide answer key" : "Preview with answer key"}
                      </button>
                    </div>
                    <Button
                      size="lg"
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
                      {preview ? (
                        <AnswerKey content={preview.content} feedback={preview.feedback} />
                      ) : previewFailure?.id === item.id ? (
                        <ActionFailureNote failure={previewFailure.failure} onRetry={() => loadPreview(item.id)} />
                      ) : (
                        <p className="text-sm text-muted-foreground">Loading…</p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {results.pageCount > 1 && (
          <div className="flex items-center justify-between text-base">
            <Button
              variant="outline"
              size="lg"
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
              size="lg"
              disabled={loading || results.page >= results.pageCount}
              onClick={() => runSearch(filters, results.page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </section>

      {/* ---- The homework ---- */}
      <aside
        ref={panelRef}
        id="this-homework"
        className="flex flex-col rounded-2xl border border-border lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-hidden"
        aria-label="This homework"
      >
        {/* On large screens the panel is one viewport tall: this middle part
            scrolls on its own (the question bank scrolls with the page) and
            the Assign button below it never leaves the screen. */}
        <div
          ref={scrollRef}
          style={fadeMask}
          className="flex flex-col gap-4 p-5 lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
        {restored && (
          <div role="status" className="flex flex-col items-start gap-2 rounded-xl bg-surface-tint p-3 text-base">
            <p>
              Picked up where you left off
              {selected.length > 0 && ` · ${selected.length} question${selected.length === 1 ? "" : "s"}`}. It&apos;s kept
              in this browser until you assign it.
            </p>
            <Button variant="outline" size="lg" onClick={startOver}>
              Start over
            </Button>
          </div>
        )}
        <div className="flex flex-col gap-2">
          <Label htmlFor="hw-title" className="text-base">Title</Label>
          <Input id="hw-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="e.g. Linear equations warm-up" className="h-11 text-base md:text-base" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="hw-due" className="text-base">Due date <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input id="hw-due" type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} className="h-11 w-fit text-base md:text-base" />
          <p className="text-sm text-muted-foreground">
            Due at the end of that day, Central time. Students who haven&apos;t finished get a reminder email the day before.
            Late work is still accepted and marked late.
          </p>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-base font-medium">How students do it</legend>
          {MODES.map((m) => (
            <label
              key={m.value}
              className={`flex cursor-pointer gap-3 rounded-xl border p-3 text-base ${mode === m.value ? "border-primary bg-primary/5" : "border-border"}`}
            >
              <input
                type="radio"
                name="mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => setMode(m.value)}
                className="mt-1 size-4 accent-primary"
              />
              <span>
                <span className="block font-medium">{m.title}</span>
                <span className="text-sm text-muted-foreground">{m.body}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-2">
          <Label htmlFor="hw-instructions" className="text-base">Instructions <span className="font-normal text-muted-foreground">(optional)</span></Label>
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
          <p className="text-base font-medium">
            Questions <span className="text-muted-foreground tabular-nums">· {selected.length}/{maxQuestions}</span>
          </p>
          {selected.length === 0 ? (
            <p className="text-base text-muted-foreground">Add questions from the list on the left with their Add buttons.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-border overflow-y-auto border-y border-border">
              {selected.map((q, i) => (
                <li key={q.id} className="flex items-start gap-2 py-2.5 text-base">
                  <span className="w-6 shrink-0 font-heading font-semibold tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                  {/* Clipped to its column: long math ran under the move buttons (review, 2026-11-09). */}
                  <span className="min-w-0 flex-1 overflow-hidden">
                    <span className="block text-sm text-muted-foreground">
                      {CATEGORY_LABELS[q.category]} · {DIFFICULTY_LABELS[q.difficulty]}
                    </span>
                    <span className="line-clamp-2">
                      <LatexText text={q.passageSnippet ?? q.snippet} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col">
                    <button type="button" aria-label={`Move question ${i + 1} up`} onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
                      <ArrowUp className="size-4" aria-hidden />
                    </button>
                    <button type="button" aria-label={`Move question ${i + 1} down`} onClick={() => move(i, 1)} disabled={i === selected.length - 1} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30">
                      <ArrowDown className="size-4" aria-hidden />
                    </button>
                  </span>
                  <button type="button" aria-label={`Remove question ${i + 1}`} onClick={() => remove(q.id)} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive">
                    <X className="size-4" aria-hidden />
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>

        {otherClasses.length > 0 && (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-base font-medium">Also assign to</legend>
            <p className="text-sm text-muted-foreground">
              Each class gets its own copy, with its own results. {className} always gets it.
            </p>
            {otherClasses.map((c) => (
              <label key={c.id} className="flex items-center gap-2.5 text-base">
                <input
                  type="checkbox"
                  checked={alsoClasses.has(c.id)}
                  onChange={() => toggleAlso(c.id)}
                  className="size-4.5 accent-primary"
                />
                {c.name}
              </label>
            ))}
          </fieldset>
        )}

        </div>
        <div className="relative flex flex-col gap-3 border-t border-border bg-background p-5 lg:shrink-0">
        {more.down && (
          <span aria-hidden className="pointer-events-none absolute -top-3.5 left-1/2 hidden -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-sm text-muted-foreground lg:flex">
            <ArrowDown className="size-3.5" aria-hidden /> More below
          </span>
        )}
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {submitFailure && <ActionFailureNote failure={submitFailure} />}
        <Button size="cta" onClick={submit} disabled={saving || submitted || selected.length === 0 || !title.trim()}>
          {saving || submitted ? "Assigning…" : classCount > 1 ? `Assign to ${classCount} classes` : "Assign to class"}
        </Button>
        <p className="text-sm text-muted-foreground">
          {/* Why the button is grey, in words (review, 2026-11-09: nothing said a title was needed). */}
          {selected.length === 0
            ? "Add at least one question to assign."
            : !title.trim()
              ? `${selected.length} question${selected.length === 1 ? "" : "s"} picked. Give the homework a title to assign it.`
              : "Students see it on their Homework page as soon as you assign it, and get an email saying it's there."}
        </p>
        </div>
      </aside>

      {/* Small screens: the panel sits below the bank, so a bar that stays in
          view says how many are picked and jumps to it. Hidden on large
          screens, where the panel itself is always on screen. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-background px-4 py-3 sm:-mx-8 sm:px-8 lg:hidden">
        <span className="text-base tabular-nums">
          {selected.length} question{selected.length === 1 ? "" : "s"} picked
        </span>
        <a
          href="#this-homework"
          className="inline-flex h-11 items-center rounded-md bg-primary px-5 text-base font-semibold text-primary-foreground"
        >
          Review and assign
        </a>
      </div>
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
      <Label htmlFor={id} className="text-sm font-medium">
        {label}
      </Label>
      <Select value={value} onValueChange={(v) => onChange(v ?? ANY)}>
        <SelectTrigger id={id} className="h-11 w-full text-base md:text-base">
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
