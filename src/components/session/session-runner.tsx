"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Bookmark, ChevronUp, Calculator as CalcIcon, Highlighter, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LinkButton } from "@/components/ui/link-button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LatexText } from "@/components/content/latex-text";
import { QuestionStatement } from "@/components/content/question-statement";
import { ExplanationSteps } from "@/components/content/explanation-steps";
import { DistractorNote } from "@/components/content/distractor-note";
import { CALCULATOR_LABELS } from "@/lib/content/labels";
import type { StudentQuestionContent, StudentQuestionFeedback } from "@/lib/session/question-content";
import type { DraftPatch } from "@/lib/session/draft";
import { isSessionBlocked, type SessionBlocked } from "@/lib/session/blocked";
import { STALE_BUILD_MESSAGE, isStaleServerActionError } from "@/lib/stale-build";
import { Calculator } from "./calculator";
import { TimerBadge } from "./timer-badge";
import { SessionNavGrid, type NavItemState } from "./session-nav-grid";
import { SplitPane } from "./split-pane";
import { Scratchpad } from "./scratchpad";
import { Annotator, highlightsSupported } from "./annotator";
import { hasSeenTip, markTipSeen, subscribeTips } from "./local-store";

// False during the server render and hydration, true straight after — the
// same idiom as the theme toggle (CLAUDE.md, next-themes gotcha). Saved
// highlights live only in this browser, so the highlighter must not render
// until after hydration or the server and client would disagree.
const noopSubscribe = () => () => {};
function useHasMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export type SessionRunnerItem = {
  id: string;
  position: number;
  submitted: boolean;
  studentAnswer: string | null;
  isCorrect: boolean | null;
  draftAnswer: string | null;
  skipped: boolean;
};

// studentAnswer is optional: the live runner already tracks it separately in
// its own `items` state (see SessionRunnerItem), so its own loadQuestion
// calls never populate this — only the results-review "detail" loaders do,
// for QuestionDetail below to look up the right distractor note.
export type LoadedQuestion = {
  content: StudentQuestionContent;
  feedback: StudentQuestionFeedback | null;
  studentAnswer?: string | null;
};

type SubmitResult = { isCorrect: boolean; feedback: StudentQuestionFeedback; studentAnswer: string };
type CompleteResult = { ok: true; redirectTo: string } | { ok: false; unansweredCount: number };

export type SessionRunnerProps = {
  title: string;
  /** What the footer pill calls each item: "Question 3 of 14", "Bonus question 1 of 4". */
  itemLabel?: string;
  /** The final button. "Finish" unless the next step isn't actually the end. */
  finishLabel?: string;
  /** Shown bottom-left, where Bluebook prints the test taker's name. */
  studentName?: string;
  initialItems: SessionRunnerItem[];
  initialPosition: number;
  initialQuestion: LoadedQuestion;
  allowBlankConfirmation: boolean;
  // Any of the three that can be refused for a reason the student should be
  // told (Premium ended, the teacher closed the homework, the Diagnostic was
  // finished in another tab) returns a SessionBlocked instead of throwing.
  loadQuestion: (itemId: string) => Promise<LoadedQuestion | SessionBlocked>;
  saveDraft: (itemId: string, patch: DraftPatch) => Promise<void>;
  savePosition: (position: number) => Promise<void>;
  submitAnswer: (itemId: string, answer: string) => Promise<SubmitResult | SessionBlocked>;
  complete: (options: { confirmBlanks: boolean }) => Promise<CompleteResult | SessionBlocked>;
};

/** Long enough to cover a burst of typing, short enough that a reload rarely loses anything. */
const DRAFT_SAVE_DELAY_MS = 500;
const DRAFT_RETRY_DELAY_MS = 1500;

const SUBMIT_FAILED = "We couldn't save that answer. Check your connection and try again.";
const LOAD_FAILED = "We couldn't load this question. Check your connection and try again.";
const FINISH_FAILED = "We couldn't finish up just now. Your answers are saved — check your connection and try again.";

/** A request that failed in a way the student can do something about, with the one thing to do. */
type Failure = { message: string; actionLabel: string; action: () => void };

export function SessionRunner(props: SessionRunnerProps) {
  const router = useRouter();
  const [items, setItems] = useState(props.initialItems);
  const [position, setPosition] = useState(props.initialPosition);
  const [cache, setCache] = useState<Map<string, LoadedQuestion>>(
    new Map([[props.initialItems[props.initialPosition].id, props.initialQuestion]]),
  );
  const [draft, setDraft] = useState(props.initialItems[props.initialPosition].draftAnswer ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [blankWarning, setBlankWarning] = useState<number | null>(null);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // Every request this runner makes can fail, and each used to leave its
  // button stuck on "Submitting…" or "Loading question…" for good. A failure
  // now says what happened and offers the retry; a block (see
  // lib/session/blocked.ts) says why the session can't go on and where to go.
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loadFailedId, setLoadFailedId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<SessionBlocked["blocked"] | null>(null);

  // Bluebook's test-taking aids. Elimination, the timer toggle and the
  // navigator are view state only and reset on reload, which matches how
  // little they cost to re-apply. "Mark for Review" is deliberately *not*
  // new state: it maps onto the existing persisted `skipped` flag, which
  // already survives a reload and already has its own colour in the
  // question navigator.
  const [navOpen, setNavOpen] = useState(false);
  const [timerHidden, setTimerHidden] = useState(false);
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [eliminated, setEliminated] = useState<Map<string, Set<string>>>(new Map());

  // Scratch work and highlighting (2026-10-24): a whiteboard per question,
  // and Bluebook's Annotate for the passage and the question. Both are kept
  // in this browser only (see local-store.ts).
  const [scratchOpen, setScratchOpen] = useState(false);
  const [annotateHint, setAnnotateHint] = useState(false);
  const mounted = useHasMounted();
  // Selecting text to highlight is invisible until you try it, so the first
  // questions a student sees say so in one line, until they dismiss it or
  // make their first highlight. Read through useSyncExternalStore (as the
  // theme toggle does) because the "seen" mark lives in the browser only; the
  // server snapshot says "seen", so nothing appears and then vanishes on load.
  const annotateTipSeen = useSyncExternalStore(subscribeTips, () => hasSeenTip("annotate"), () => true);
  const passageRef = useRef<HTMLDivElement | null>(null);
  const questionRef = useRef<HTMLDivElement | null>(null);
  const annotationRoots = useMemo(() => ({ passage: passageRef, question: questionRef }), []);

  // The question on screen, for requests that resolve after the student has
  // moved on: their result still lands on the right question, but only the
  // current one gets the visible follow-up (focus, an error message).
  const currentId = useRef(props.initialItems[props.initialPosition].id);
  const focusResultNext = useRef(false);

  // Draft autosave. Next runs one client's server actions one at a time, so a
  // save fired on every keystroke and every tap queued up in front of Submit
  // and of the next question's load. Now a draft waits until the typing stops,
  // only the latest value is sent, and a value the server already has isn't
  // sent again. A draft still waiting is sent straight away when the student
  // moves to another question, marks one for review, or leaves the page, so a
  // reload still finds it; Submit drops it, because the answer is about to be
  // sent as itself.
  const pendingDraft = useRef<{ itemId: string; value: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const sentDrafts = useRef(
    new Map<string, DraftPatch>(props.initialItems.map((it) => [it.id, { draftAnswer: it.draftAnswer, skipped: it.skipped }])),
  );
  const draftVersions = useRef(new Map<string, number>());

  const currentItem = items[position];
  const loaded = cache.get(currentItem.id);

  function reportStale() {
    // After a deploy every request from this page fails the same way, so a
    // retry can't help; a reload can. Nothing from the failed request was
    // written, so there is nothing to lose.
    setFailure({ message: STALE_BUILD_MESSAGE, actionLabel: "Reload page", action: () => window.location.reload() });
  }

  function reportFailure(err: unknown, message: string, retry: () => void) {
    if (isStaleServerActionError(err)) reportStale();
    else setFailure({ message, actionLabel: "Try again", action: retry });
  }

  function stop(result: SessionBlocked) {
    cancelDraftSave();
    setFailure(null);
    setBlankWarning(null);
    setBlocked(result.blocked);
  }

  // Sends one draft patch in the background. A failure is retried once after
  // a pause, unless a newer save for the same question has gone out since;
  // after that it's let go, because the answer is what counts and Submit
  // reports its own failures.
  function persistDraft(itemId: string, patch: DraftPatch) {
    const version = (draftVersions.current.get(itemId) ?? 0) + 1;
    draftVersions.current.set(itemId, version);
    sentDrafts.current.set(itemId, { ...sentDrafts.current.get(itemId), ...patch });
    const send = (isRetry: boolean) => {
      props.saveDraft(itemId, patch).catch((err: unknown) => {
        if (isStaleServerActionError(err)) return reportStale();
        if (draftVersions.current.get(itemId) !== version) return;
        if (!isRetry) {
          setTimeout(() => {
            if (draftVersions.current.get(itemId) === version) send(true);
          }, DRAFT_RETRY_DELAY_MS);
          return;
        }
        // Forget what we thought was saved, so the next change sends it again.
        sentDrafts.current.delete(itemId);
      });
    };
    send(false);
  }

  // Where a reload resumes. Only worth mentioning to the student when the
  // page is stale; otherwise the next move saves it again.
  function persistPosition(nextPosition: number) {
    props.savePosition(nextPosition).catch((err: unknown) => {
      if (isStaleServerActionError(err)) reportStale();
    });
  }

  function cancelDraftSave() {
    if (pendingDraft.current) clearTimeout(pendingDraft.current.timer);
    pendingDraft.current = null;
  }

  function flushDraftSave() {
    const pending = pendingDraft.current;
    if (!pending) return;
    cancelDraftSave();
    const sent = sentDrafts.current.get(pending.itemId);
    if (sent?.draftAnswer === pending.value && sent.skipped === false) return;
    persistDraft(pending.itemId, { draftAnswer: pending.value, skipped: false });
  }

  function scheduleDraftSave(itemId: string, value: string) {
    if (pendingDraft.current && pendingDraft.current.itemId !== itemId) flushDraftSave();
    else cancelDraftSave();
    pendingDraft.current = { itemId, value, timer: setTimeout(flushDraftSave, DRAFT_SAVE_DELAY_MS) };
  }

  // Leaving the page (a tab switch or close on a phone, the focus bar's Exit)
  // sends a draft still waiting rather than dropping it.
  const flushOnLeave = useEffectEvent(() => flushDraftSave());
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushOnLeave();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      flushOnLeave();
    };
  }, []);

  // After Submit the button that had focus is gone, and focus fell to the
  // page. It goes to the result line instead, which a screen reader then
  // reads, and Tab continues from there to the explanation and Next.
  const focusResult = useCallback((el: HTMLParagraphElement | null) => {
    if (el && focusResultNext.current) {
      focusResultNext.current = false;
      el.focus();
    }
  }, []);

  function toggleEliminated(choiceId: string) {
    setEliminated((prev) => {
      const next = new Map(prev);
      const forItem = new Set(next.get(currentItem.id) ?? []);
      if (forItem.has(choiceId)) forItem.delete(choiceId);
      else forItem.add(choiceId);
      next.set(currentItem.id, forItem);
      return next;
    });
  }

  // Bluebook's Mark for Review does not advance to the next question;
  // handleSkip does. Same persisted flag, different gesture.
  function toggleMarked() {
    const next = !currentItem.skipped;
    setItems((prev) => prev.map((it) => (it.id === currentItem.id ? { ...it, skipped: next } : it)));
    // A draft still waiting carries `skipped: false`; sent after this, it
    // would quietly un-mark the question.
    flushDraftSave();
    persistDraft(currentItem.id, { skipped: next });
  }

  async function fetchQuestion(itemId: string) {
    setLoadFailedId((id) => (id === itemId ? null : id));
    let result: LoadedQuestion | SessionBlocked;
    try {
      result = await props.loadQuestion(itemId);
    } catch (err) {
      setLoadFailedId(itemId);
      if (currentId.current === itemId) {
        reportFailure(err, LOAD_FAILED, () => {
          setFailure(null);
          void fetchQuestion(itemId);
        });
      }
      return;
    }
    if (isSessionBlocked(result)) {
      setLoadFailedId(itemId);
      stop(result);
      return;
    }
    const question = result;
    setCache((prev) => new Map(prev).set(itemId, question));
  }

  async function goToPosition(nextPosition: number) {
    if (nextPosition === position) return;
    // Sent before the position below (actions run in the order they're sent),
    // so a reload lands on this question with its draft in place.
    flushDraftSave();
    const nextItem = items[nextPosition];
    currentId.current = nextItem.id;
    setPosition(nextPosition);
    setDraft(nextItem.draftAnswer ?? "");
    setBlankWarning(null);
    setCompleteError(null);
    setFailure(null);
    if (!cache.has(nextItem.id)) await fetchQuestion(nextItem.id);
    persistPosition(nextPosition);
  }

  function updateDraft(value: string) {
    setDraft(value);
    setItems((prev) => prev.map((it) => (it.id === currentItem.id ? { ...it, draftAnswer: value, skipped: false } : it)));
    scheduleDraftSave(currentItem.id, value);
  }

  async function handleSkip() {
    setItems((prev) => prev.map((it) => (it.id === currentItem.id ? { ...it, skipped: true } : it)));
    flushDraftSave();
    persistDraft(currentItem.id, { skipped: true });
    if (position < items.length - 1) await goToPosition(position + 1);
  }

  // Both question types take an explicit Submit (a tap on a choice is only a
  // draft; see the comment above the Submit button). Enter submits a numeric
  // answer.
  async function handleSubmit(answer: string = draft) {
    if (!answer || submitting || blocked || !loaded) return;
    const item = currentItem;
    const content = loaded.content;
    if (pendingDraft.current?.itemId === item.id) cancelDraftSave();
    setSubmitting(true);
    setFailure(null);
    let result: SubmitResult | SessionBlocked;
    try {
      result = await props.submitAnswer(item.id, answer);
    } catch (err) {
      setSubmitting(false);
      // Kept as a draft, so a reload before the retry still has it.
      scheduleDraftSave(item.id, answer);
      reportFailure(err, SUBMIT_FAILED, () => void handleSubmit(answer));
      return;
    }
    setSubmitting(false);
    if (isSessionBlocked(result)) {
      stop(result);
      return;
    }
    // What the server recorded, not this tab's draft. If the question was
    // answered in another tab first, the server returns that answer, and the
    // verdict, the highlight and the distractor note must all describe it.
    // Highlighting this tab's pick beside the other answer's verdict could
    // mark a choice "Correct!" that was never the one graded.
    const saved = result;
    setItems((prev) =>
      prev.map((it) =>
        it.id === item.id
          ? {
              ...it,
              submitted: true,
              studentAnswer: saved.studentAnswer,
              draftAnswer: saved.studentAnswer,
              isCorrect: saved.isCorrect,
              skipped: false,
            }
          : it,
      ),
    );
    setCache((prev) => new Map(prev).set(item.id, { content, feedback: saved.feedback }));
    if (currentId.current === item.id) {
      setDraft(saved.studentAnswer);
      focusResultNext.current = true;
    }
  }

  async function handleFinish(confirmBlanks: boolean) {
    if (completing || blocked) return;
    setCompleting(true);
    setCompleteError(null);
    setFailure(null);
    let result: CompleteResult | SessionBlocked;
    try {
      result = await props.complete({ confirmBlanks });
    } catch (err) {
      setCompleting(false);
      setBlankWarning(null);
      reportFailure(err, FINISH_FAILED, () => void handleFinish(confirmBlanks));
      return;
    }
    if (isSessionBlocked(result)) {
      setCompleting(false);
      stop(result);
      return;
    }
    if (result.ok) {
      router.push(result.redirectTo);
      return;
    }
    setCompleting(false);
    if (props.allowBlankConfirmation) {
      setBlankWarning(result.unansweredCount);
    } else {
      setCompleteError(`${result.unansweredCount} question${result.unansweredCount === 1 ? "" : "s"} remain unanswered.`);
      const firstUnanswered = items.find((it) => !it.submitted);
      if (firstUnanswered) await goToPosition(firstUnanswered.position);
    }
  }

  const unansweredCount = items.filter((it) => !it.submitted).length;
  const firstUnanswered = items.find((it) => !it.submitted) ?? null;

  const navItems = items.map((it) => ({
    position: it.position,
    state: (it.position === position ? "current" : it.submitted ? "submitted" : it.skipped ? "skipped" : "unanswered") as NavItemState,
  }));

  const marked = currentItem.skipped;
  const eliminatedHere = eliminated.get(currentItem.id) ?? new Set<string>();
  // Once submitted, the answer on screen is the one the server graded.
  const shownAnswer = currentItem.submitted ? (currentItem.studentAnswer ?? draft) : draft;

  // Truthiness, not `!== null`: a stale client or an older payload makes this
  // undefined, and `undefined !== null` is true, which split the screen and
  // left an empty pane beside every maths question. An all-whitespace passage
  // saved from the editor would do the same.
  const hasPassage = (loaded?.content.passageText ?? "").trim().length > 0;

  // Width follows the content, the way Bluebook's two module types do. A
  // passage question splits the whole window in half — passage left, question
  // right — so each side gets a real reading column. A single-column question
  // (maths, or a stem with no passage) stays a centred column, because one
  // line of text stretched across a wide monitor is harder to read, not
  // easier. The column used to be max-w-3xl for both, which on a wide monitor
  // left a passage and its question sharing a third of the screen at roughly
  // 350px each, with the rest empty.
  const columnWidth = hasPassage ? "max-w-screen-2xl" : "max-w-4xl";

  return (
    // Laid out like Bluebook: a band at the top carrying the section label,
    // the clock and the tools, the question in the middle, and a band at the
    // bottom carrying the name, the navigator and Back/Next. The dashed
    // rules are Bluebook's too, and they are most of why this reads as the
    // real thing rather than a generic quiz.
    //
    // Brand colour is kept for the controls rather than Bluebook's blue. The
    // shape is what creates the familiarity; repainting the product another
    // organisation's blue is a separate decision and not one this makes.
    <div className="flex flex-1 flex-col bg-background">
      <header className="border-b border-dashed border-foreground/40 px-4 py-3 sm:px-8">
        <div className="mx-auto grid w-full max-w-screen-2xl grid-cols-[1fr_auto_1fr] items-center gap-4">
          <div className="min-w-0">
            <p className="truncate font-heading text-sm font-semibold tracking-tight sm:text-base">{props.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {loaded ? CALCULATOR_LABELS[loaded.content.calculatorSetting] : " "}
            </p>
          </div>

          <div className="flex flex-col items-center">
            {loaded && !timerHidden && (
              <TimerBadge suggestedTimeSeconds={loaded.content.suggestedTimeSeconds} resetKey={currentItem.id} />
            )}
            <button
              type="button"
              onClick={() => setTimerHidden((v) => !v)}
              // The pill is small on purpose; the ::after is an invisible
              // margin around it, so a thumb doesn't have to land on 21px.
              className="relative mt-1 rounded-full border border-border px-3 py-0.5 text-xs font-medium after:absolute after:-inset-2 after:content-[''] hover:bg-muted"
            >
              {timerHidden ? "Show" : "Hide"}
            </button>
          </div>

          <div className="flex items-center justify-end gap-4">
            {mounted && highlightsSupported() && (
              <button
                type="button"
                onClick={() => setAnnotateHint((v) => !v)}
                aria-expanded={annotateHint}
                className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <Highlighter className="size-5" aria-hidden />
                Annotate
              </button>
            )}
            <button
              type="button"
              onClick={() => setScratchOpen((v) => !v)}
              aria-pressed={scratchOpen}
              className={`flex flex-col items-center gap-0.5 text-xs hover:text-foreground ${scratchOpen ? "text-foreground" : "text-muted-foreground"}`}
            >
              <PenLine className="size-5" aria-hidden />
              Scratch work
            </button>
            {loaded?.content.calculatorSetting === "ALLOWED" && (
              <button
                type="button"
                onClick={() => setCalculatorOpen((v) => !v)}
                aria-pressed={calculatorOpen}
                className="flex flex-col items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <CalcIcon className="size-5" aria-hidden />
                Calculator
              </button>
            )}
          </div>
        </div>
      </header>

      <main className={`mx-auto w-full ${columnWidth} flex-1 px-4 py-6 sm:px-8`}>
        {completeError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{completeError}</AlertDescription>
          </Alert>
        )}

        {!loaded ? (
          // A failed load says so in the footer, with Try again; this space
          // stays empty rather than claiming it's still loading.
          loadFailedId === currentItem.id || blocked ? null : (
            <div className="py-16 text-sm text-muted-foreground">Loading question…</div>
          )
        ) : (
          <>
            {/* Bluebook's question strip: a filled number badge, Mark for
                Review, and the answer-elimination toggle on the right. */}
            <div className="flex items-center justify-between gap-3 border-b-2 border-dashed border-foreground/40 bg-muted/70 px-3 py-1.5">
              <div className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center bg-foreground font-heading text-sm font-bold text-background">
                  {position + 1}
                </span>
                <button
                  type="button"
                  onClick={toggleMarked}
                  aria-pressed={marked}
                  // Taller to tap than it looks: the padding is given back by
                  // the negative margin, so the strip keeps its height.
                  className="-my-2 flex items-center gap-1.5 py-2 text-sm hover:underline"
                >
                  <Bookmark className={marked ? "size-4 fill-current" : "size-4"} aria-hidden />
                  Mark for Review
                </button>
              </div>
            </div>

            {annotateHint ? (
              <p role="status" className="mt-3 border-l-2 border-marker pl-3 text-sm text-muted-foreground">
                Select any words in the passage or the question to highlight them or add a note. Click a highlight to
                change or remove it.
              </p>
            ) : (
              mounted &&
              highlightsSupported() &&
              !annotateTipSeen && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg bg-surface-tint px-4 py-2.5 text-sm">
                  <p className="flex items-center gap-2">
                    <Highlighter className="size-4 shrink-0 text-primary" aria-hidden />
                    <span>
                      <span className="font-medium">Tip:</span> select any words in the passage or the question to
                      highlight them or add a note.
                    </span>
                  </p>
                  <button
                    type="button"
                    onClick={() => markTipSeen("annotate")}
                    className="-my-1 px-1 py-1 font-medium text-primary hover:underline"
                  >
                    Got it
                  </button>
                </div>
              )
            )}

            <div className="pt-5">
              <SplitPane
                hasPassage={hasPassage}
                left={
                  <div ref={passageRef}>
                    <QuestionStatement
                      text={loaded.content.passageText ?? ""}
                      imageId={null}
                      mediaBasePath="/api/media"
                      className="bg-transparent p-0"
                      textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
                    />
                  </div>
                }
              >
              {/* No tinted panel behind the stem. Bluebook sets the question
                  as plain text on the page, and the box made every question
                  look like a callout rather than the thing being asked. */}
              <div ref={questionRef}>
                <QuestionStatement
                  text={loaded.content.questionText}
                  imageId={loaded.content.questionImageId}
                  mediaBasePath="/api/media"
                  className="bg-transparent p-0"
                  textClassName="text-lg leading-relaxed lg:text-xl lg:leading-relaxed"
                />
              </div>

              {calculatorOpen && loaded.content.calculatorSetting === "ALLOWED" && (
                <div className="mt-4">
                  <Calculator defaultOpen />
                </div>
              )}

              <div className="mt-6 flex flex-col gap-3">
                {loaded.content.questionType === "MULTIPLE_CHOICE" ? (
                  loaded.content.answerChoices.map((choice, choiceIndex) => {
                    const letter = String.fromCharCode(65 + choiceIndex);
                    const isSelected = shownAnswer === choice.id;
                    const showCorrect = currentItem.submitted && loaded.feedback?.correctChoiceId === choice.id;
                    const showWrongSelection =
                      currentItem.submitted && isSelected && loaded.feedback?.correctChoiceId !== choice.id;
                    const isOut = eliminatedHere.has(choice.id) && !currentItem.submitted;
                    // Said in words as well as colour (WCAG 1.4.1): green and
                    // red borders alone are the same border to a student who
                    // can't tell those colours apart. Part of the button's
                    // accessible name, so a screen reader hears it too.
                    const tag = !currentItem.submitted
                      ? null
                      : isSelected && showCorrect
                        ? "Your answer · Correct"
                        : isSelected
                          ? "Your answer"
                          : showCorrect
                            ? "Correct answer"
                            : null;
                    return (
                      <div key={choice.id} className="flex items-center gap-3">
                        <button
                          type="button"
                          disabled={currentItem.submitted || submitting || !!blocked}
                          onClick={() => {
                            if (isOut) return;
                            updateDraft(choice.id);
                          }}
                          aria-pressed={isSelected}
                          // A content-agnostic hook for the e2e suite. The
                          // accessible name is the choice's own text (the
                          // letter is aria-hidden), and `aria-pressed` alone
                          // also matches Mark for Review and the cross-outs.
                          data-answer-choice={letter}
                          className={[
                            "flex flex-1 items-center gap-4 rounded-lg border-2 px-4 py-3 text-left text-base transition-colors lg:px-5 lg:py-4 lg:text-lg",
                            isSelected && !currentItem.submitted && "border-primary bg-primary/10",
                            !isSelected && !showCorrect && !showWrongSelection && "border-border hover:border-foreground/40",
                            showCorrect && "border-green-600 bg-green-100 dark:border-green-500 dark:bg-green-900/50",
                            showWrongSelection && "border-destructive bg-destructive/5",
                            isOut && "opacity-45",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                        >
                          <span
                            aria-hidden
                            className={[
                              "flex size-7 shrink-0 items-center justify-center rounded-full border text-sm font-semibold lg:size-8 lg:text-base",
                              isSelected && !currentItem.submitted
                                ? "border-primary bg-primary text-primary-foreground"
                                : "border-foreground/40 text-foreground",
                            ].join(" ")}
                          >
                            {letter}
                          </span>
                          <span className={["min-w-0 flex-1", isOut && "line-through"].filter(Boolean).join(" ")}>
                            <LatexText text={choice.text} />
                            {choice.imageId && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/media/${choice.imageId}`} alt="" className="mt-2 max-w-full rounded" />
                            )}
                          </span>
                          {tag && (
                            <>
                              {" "}
                              <span
                                className={`shrink-0 self-center text-sm font-semibold ${showWrongSelection ? "text-destructive" : "text-green-800 dark:text-green-300"}`}
                              >
                                {tag}
                              </span>
                            </>
                          )}
                        </button>

                        {/* Bluebook puts the cross-out control outside the
                            choice, so ruling an answer out can never be
                            mistaken for selecting it. */}
                        {!currentItem.submitted && (
                          <button
                            type="button"
                            onClick={() => toggleEliminated(choice.id)}
                            aria-pressed={isOut}
                            aria-label={isOut ? `Restore answer ${letter}` : `Cross out answer ${letter}`}
                            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-foreground/40 text-xs font-semibold line-through hover:bg-muted lg:size-8 lg:text-sm"
                          >
                            {letter}
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div>
                    <input
                      type="text"
                      value={shownAnswer}
                      onChange={(e) => updateDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleSubmit();
                      }}
                      disabled={currentItem.submitted || !!blocked}
                      aria-label="Your answer"
                      className="w-44 rounded-lg border-2 border-foreground/40 px-3 py-2 text-lg disabled:bg-muted"
                    />
                    {/* Bluebook echoes what has been typed under the box, so a
                        student can check a fraction or a decimal before moving on. */}
                    <p className="mt-4 font-heading text-lg font-semibold">
                      Answer Preview <span className="font-normal text-muted-foreground">{shownAnswer || "—"}</span>
                    </p>
                  </div>
                )}
              </div>

              {blocked && !currentItem.submitted ? null : !currentItem.submitted ? (
                // Selecting no longer grades. A tap used to submit on the
                // spot, which made trying a choice indistinguishable from
                // committing to one — a student comparing options had
                // already been marked wrong. Both question types now take an
                // explicit Submit, and until then the choice is only a saved
                // draft.
                <div className="mt-6 flex flex-wrap gap-3">
                  <Button size="cta" onClick={() => void handleSubmit()} disabled={!draft || submitting}>
                    {submitting ? "Submitting…" : "Submit answer"}
                  </Button>
                  <Button size="cta" variant="ghost" onClick={handleSkip} disabled={submitting}>
                    Skip for now
                  </Button>
                </div>
              ) : (
                <div className="mt-6 flex flex-col gap-3">
                  <p
                    ref={focusResult}
                    role="status"
                    tabIndex={-1}
                    className={`font-heading text-lg font-semibold focus:outline-none ${currentItem.isCorrect ? "text-green-700 dark:text-green-400" : "text-destructive"}`}
                  >
                    {currentItem.isCorrect ? "Correct!" : "Incorrect."}
                  </p>
                  {loaded.content.questionType === "OPEN_ENDED_NUMERIC" && loaded.feedback && (
                    <p className="text-sm text-muted-foreground">Accepted answer {loaded.feedback.acceptedAnswers[0]}</p>
                  )}
                  {!currentItem.isCorrect &&
                    currentItem.studentAnswer &&
                    loaded.feedback?.distractorExplanationsByChoiceId[currentItem.studentAnswer] && (
                      <DistractorNote text={loaded.feedback.distractorExplanationsByChoiceId[currentItem.studentAnswer]} />
                    )}
                  {loaded.feedback && loaded.feedback.explanationSteps.length > 0 ? (
                    <ExplanationSteps steps={loaded.feedback.explanationSteps} mediaBasePath="/api/media" walkthrough={loaded.feedback.walkthrough} />
                  ) : (
                    loaded.feedback?.writtenExplanation && (
                      <div className="rounded-md bg-muted p-3 text-sm">
                        <LatexText text={loaded.feedback.writtenExplanation} />
                      </div>
                    )
                  )}
                  {loaded.feedback?.explanationVideoId && (
                    <video controls className="w-full rounded" src={`/api/media/${loaded.feedback.explanationVideoId}`} />
                  )}
                </div>
              )}

              {/* Keyed by question so each one keeps its own highlights. */}
              {mounted && (
                <Annotator
                  key={currentItem.id}
                  storageKey={currentItem.id}
                  roots={annotationRoots}
                  contentKey={`${currentItem.id}:${loaded.content.questionRevisionId}:${hasPassage}`}
                />
              )}
              </SplitPane>
            </div>
          </>
        )}
      </main>

      {/* The navigator lives behind the footer pill the way Bluebook's does,
          rather than sitting above every question taking the top third of a
          phone screen. */}
      {navOpen && (
        <div className={`mx-auto w-full ${columnWidth} px-4 pb-3 sm:px-8`}>
          <div className="rounded-xl border border-border bg-card p-4 shadow-lg">
            <SessionNavGrid
              items={navItems}
              onSelect={(p) => {
                setNavOpen(false);
                void goToPosition(p);
              }}
            />
          </div>
        </div>
      )}

      {/* Pinned, like Bluebook's: the question pill and Back/Next are how a
          student moves through the test, and they used to sit below the fold
          on a laptop — the runner was min-h-screen beneath the focus bar, so it
          always overflowed by at least that bar's height. */}
      <footer className="sticky bottom-0 z-10 border-t border-dashed border-foreground/40 bg-background px-4 py-3 sm:px-8">
        {/* In the pinned footer, so it's on screen wherever the student has
            scrolled to when a request fails, beside the controls it's about. */}
        {(blocked || failure) && (
          <div className="mx-auto mb-3 w-full max-w-screen-2xl">
            {blocked ? (
              <Alert>
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <p className="text-sm">{blocked.message}</p>
                  <LinkButton href={blocked.href}>{blocked.linkLabel}</LinkButton>
                </div>
              </Alert>
            ) : (
              failure && (
                <Alert variant="destructive">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                    <p className="text-sm">{failure.message}</p>
                    <Button variant="outline" onClick={failure.action}>
                      {failure.actionLabel}
                    </Button>
                  </div>
                </Alert>
              )
            )}
          </div>
        )}
        <div className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-3">
          <span className="hidden min-w-0 flex-1 truncate font-heading font-semibold sm:block">
            {props.studentName ?? ""}
          </span>

          <button
            type="button"
            onClick={() => setNavOpen((v) => !v)}
            aria-expanded={navOpen}
            className="flex items-center gap-2 rounded-lg bg-foreground px-4 py-2 text-sm font-semibold text-background"
          >
            {props.itemLabel ?? "Question"} {position + 1} of {items.length}
            <ChevronUp
              className={navOpen ? "size-4 rotate-180 transition-transform" : "size-4 transition-transform"}
              aria-hidden
            />
          </button>

          <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
            <Button
              variant="outline"
              className="rounded-full"
              disabled={position === 0}
              onClick={() => void goToPosition(position - 1)}
            >
              Back
            </Button>
            {unansweredCount === 0 ? (
              <Button className="rounded-full" onClick={() => void handleFinish(false)} disabled={completing || !!blocked}>
                {completing ? "One moment…" : (props.finishLabel ?? "Finish")}
              </Button>
            ) : position === items.length - 1 ? (
              <Button className="rounded-full" onClick={() => void goToPosition(firstUnanswered!.position)}>
                {unansweredCount} left
              </Button>
            ) : (
              <Button className="rounded-full" onClick={() => void goToPosition(position + 1)}>
                Next
              </Button>
            )}
          </div>
        </div>
      </footer>

      {scratchOpen && <Scratchpad key={currentItem.id} storageKey={currentItem.id} onClose={() => setScratchOpen(false)} />}

      {blankWarning !== null && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4" role="alertdialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-2xl bg-card p-6 shadow-lg">
            <p className="mb-2 font-medium">
              {blankWarning} question{blankWarning === 1 ? "" : "s"} unanswered
            </p>
            <p className="mb-4 text-sm text-muted-foreground">
              Unanswered questions will be counted as incorrect. You can go back and answer them, or submit anyway.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBlankWarning(null)}>
                Go back
              </Button>
              <Button onClick={() => void handleFinish(true)} disabled={completing}>
                {completing ? "Submitting…" : "Submit anyway"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
