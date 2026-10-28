"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  changedPanelsAt,
  choiceChangesAt,
  panelId,
  promptAnswers,
  promptAt,
  stateAt,
  type PanelState,
  type Prompt,
  type WalkthroughView,
} from "@/lib/content/walkthrough";
import { isVisible, revealTargets, type RevealTarget } from "./reveal";

// One walkthrough's state, shared by everything that draws it. A question
// page puts the provider around the whole question, so the walkthrough can
// run on the question itself: highlights painted on the real passage
// (on-question.tsx), the real answer choices crossed out, and only what the
// question doesn't show (a graph, the working, a table) drawn in the stage.
// The dock — the explanation and Back/Next — sits at the end of the question
// and stays pinned to the bottom of the screen while any of it is in view.
//
// Without a host (the question editor's preview), Walkthrough wraps itself in
// a provider with onQuestion false and draws the passage and choices too.

export type StepText = { text: string; imageId: string | null };

/** What the walkthrough's last button does on a page that has somewhere to go next. */
export type WalkthroughFinish = { label: string; onClick: () => void };

type Mode = "walkthrough" | "list";
type PromptStatus = "right" | "shown";

export type WalkthroughHost = {
  view: WalkthroughView;
  steps: StepText[];
  mediaBasePath: string;
  onQuestion: boolean;
  /** The choice the student answered, by index; null for a grid-in or a preview with no answer. */
  studentChoiceIndex: number | null;
  /** Why each wrong choice is wrong, by index, shown when a step rules it out. */
  choiceNotes: (string | null)[];
  finish: WalkthroughFinish | null;
  /** True where a student is answering, so the last step can ask "Did this make sense?". */
  collectFeedback: boolean;
  /** The dock folded down to its controls and a line of narration (phones). */
  folded: boolean;
  setFolded: (folded: boolean) => void;

  index: number;
  total: number;
  go: (index: number) => void;
  /**
   * The step whose state is drawn. One behind `index` while that step's
   * "your turn" question is open, so the stage shows what the student has to
   * work from, not the answer.
   */
  shownIndex: number;
  states: Map<string, PanelState>;
  /** Panels the shown step changed, for the pulse and for scrolling to the change. */
  changed: Set<string>;
  choiceChanges: { focus: number | null; eliminate: number[]; reveal: boolean };
  pendingPrompt: Prompt | null;
  promptResult: PromptStatus | null;
  wrongTries: number[];
  answerPrompt: (option: number) => void;
  showPromptAnswer: () => void;

  mode: Mode;
  setMode: (mode: Mode) => void;
  finished: boolean;
  setFinished: (finished: boolean) => void;
  expanded: boolean;
  setExpanded: (expanded: boolean) => void;
  /** True on the first step until the student moves, when what step 1 changed is out of sight. */
  changeOffscreen: boolean;
  showChange: () => void;
  registerTarget: (key: string, get: () => RevealTarget | null) => () => void;
};

const WalkthroughContext = createContext<WalkthroughHost | null>(null);

export function useOptionalWalkthrough(): WalkthroughHost | null {
  return useContext(WalkthroughContext);
}

/** True when the walkthrough is drawing on the question: marks belong on the real passage and choices. */
export function useOnQuestion(): WalkthroughHost | null {
  const wt = useContext(WalkthroughContext);
  return wt && wt.onQuestion && wt.mode === "walkthrough" ? wt : null;
}

// Preferences remembered per browser: "All steps" or the step-through, and
// whether the dock is folded down (on a phone). Read through
// useSyncExternalStore: the server snapshot is the default, so a page
// rendered on the server never disagrees with its first client render.
function browserPref<T extends string>(key: string, fallback: T, values: readonly T[]) {
  const event = `prephub:${key}`;
  let thisVisit: T | null = null;
  return {
    read(): T {
      if (thisVisit) return thisVisit;
      try {
        const stored = window.localStorage.getItem(`prephub:pref:${key}`);
        return values.includes(stored as T) ? (stored as T) : fallback;
      } catch {
        return fallback;
      }
    },
    write(value: T) {
      thisVisit = value;
      try {
        window.localStorage.setItem(`prephub:pref:${key}`, value);
      } catch {
        // Storage blocked: the in-memory choice holds for this visit.
      }
      window.dispatchEvent(new Event(event));
    },
    subscribe(onChange: () => void): () => void {
      window.addEventListener(event, onChange);
      window.addEventListener("storage", onChange);
      return () => {
        window.removeEventListener(event, onChange);
        window.removeEventListener("storage", onChange);
      };
    },
    server: () => fallback,
  };
}

const modePref = browserPref<Mode>("walkthrough-mode", "walkthrough", ["walkthrough", "list"]);
const writeMode = (mode: Mode) => modePref.write(mode);
const compactPref = browserPref<"open" | "folded">("walkthrough-dock", "open", ["open", "folded"]);

// Stands in while a page's provider is switched off (the question isn't
// answered yet, or has no walkthrough), so the hooks below always run.
const EMPTY: WalkthroughView = { spec: { version: 1, panels: [{ type: "work" }], steps: [{}] }, passageText: null, choices: [], correctIndex: null };

/**
 * `view` null switches the provider off: it stays in the tree (so switching
 * it on at Submit doesn't rebuild the question under it, losing scroll
 * positions and the passage pane's width) and provides nothing.
 * `resetKey` starts it over at step 1 when the page moves to another question.
 */
export function WalkthroughProvider({
  view,
  steps,
  mediaBasePath,
  onQuestion,
  studentChoiceIndex = null,
  choiceNotes = [],
  finish = null,
  collectFeedback = false,
  resetKey = "",
  children,
}: {
  view: WalkthroughView | null;
  steps: StepText[];
  mediaBasePath: string;
  onQuestion: boolean;
  studentChoiceIndex?: number | null;
  choiceNotes?: (string | null)[];
  finish?: WalkthroughFinish | null;
  collectFeedback?: boolean;
  resetKey?: string;
  children: ReactNode;
}) {
  const active = view && steps.length > 0 && view.spec.steps.length === steps.length ? view : null;
  const shown = active ?? EMPTY;
  const spec = shown.spec;
  const total = steps.length;
  const [index, setIndex] = useState(0);
  const [moves, setMoves] = useState(0);
  const [results, setResults] = useState<Record<number, PromptStatus>>({});
  const [wrongTries, setWrongTries] = useState<number[]>([]);
  const [finished, setFinished] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [changeOffscreen, setChangeOffscreen] = useState(false);
  const mode = useSyncExternalStore(modePref.subscribe, modePref.read, modePref.server);
  const folded = useSyncExternalStore(compactPref.subscribe, compactPref.read, compactPref.server) === "folded";
  const targets = useRef(new Map<string, () => RevealTarget | null>());

  // Another question (or the same one switched on): start over. Adjusted
  // during render, React's pattern for state that follows a prop.
  const startKey = `${resetKey}\u0000${active ? "on" : "off"}`;
  const [seenKey, setSeenKey] = useState(startKey);
  if (seenKey !== startKey) {
    setSeenKey(startKey);
    setIndex(0);
    setMoves(0);
    setResults({});
    setWrongTries([]);
    setFinished(false);
    setExpanded(false);
    setChangeOffscreen(false);
  }

  const prompt = active ? promptAt(spec, index) : null;
  const promptResult = prompt ? (results[index] ?? null) : null;
  const pendingPrompt = prompt && !promptResult ? prompt : null;
  const shownIndex = pendingPrompt ? index - 1 : index;

  const states = useMemo(() => stateAt(spec, shownIndex), [spec, shownIndex]);
  const changed = useMemo(() => (shownIndex < 0 ? new Set<string>() : changedPanelsAt(spec, shownIndex)), [spec, shownIndex]);
  const choiceChanges = useMemo(
    () => (shownIndex < 0 ? { focus: null, eliminate: [], reveal: false } : choiceChangesAt(spec, shownIndex)),
    [spec, shownIndex],
  );

  const moved = useCallback(() => setMoves((m) => m + 1), []);
  const setFolded = useCallback((next: boolean) => compactPref.write(next ? "folded" : "open"), []);

  const go = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(total - 1, next));
      setIndex(clamped);
      setWrongTries([]);
      setFinished(false);
      setChangeOffscreen(false);
      moved();
    },
    [total, moved],
  );

  const answerPrompt = useCallback(
    (option: number) => {
      if (!pendingPrompt) return;
      if (promptAnswers(pendingPrompt).includes(option)) {
        setResults((r) => ({ ...r, [index]: "right" }));
        moved();
      } else {
        setWrongTries((tries) => (tries.includes(option) ? tries : [...tries, option]));
      }
    },
    [pendingPrompt, index, moved],
  );

  const showPromptAnswer = useCallback(() => {
    if (!pendingPrompt) return;
    setResults((r) => ({ ...r, [index]: "shown" }));
    moved();
  }, [pendingPrompt, index, moved]);

  const registerTarget = useCallback((key: string, get: () => RevealTarget | null) => {
    targets.current.set(key, get);
    return () => {
      if (targets.current.get(key) === get) targets.current.delete(key);
    };
  }, []);

  // What the shown step changed, by priority rather than by the order the
  // panels happen to be listed: the passage, then the stage (the graph or
  // the working is where a step's reasoning is), then the answer choices,
  // which the dock also names in words. When they all fit on screen they
  // are all shown; when they don't, the first one is (reveal.ts).
  const changeKeys = useMemo(() => {
    if (shownIndex < 0 || !active) return [];
    const passage: string[] = [];
    const stage: string[] = [];
    const choices: string[] = [];
    for (const panel of spec.panels) {
      const id = panelId(panel);
      if (!changed.has(id)) continue;
      if (onQuestion && panel.type === "passage") passage.push("passage", "passage-fill");
      else if (onQuestion && panel.type === "choices") {
        for (const i of [...choiceChanges.eliminate, ...(choiceChanges.focus !== null ? [choiceChanges.focus] : [])]) choices.push(`choice-${i}`);
        if (choiceChanges.reveal && active.correctIndex !== null) choices.push(`choice-${active.correctIndex}`);
        // In the stage, the working's new line first: it's what the narration says.
      } else if (panel.type === "work") stage.unshift(`panel-${id}`);
      else if (panel.type !== "vars") stage.push(`panel-${id}`);
    }
    return [...passage, ...stage, ...choices];
  }, [active, spec, changed, choiceChanges, onQuestion, shownIndex]);

  const resolveTargets = useCallback(
    () => changeKeys.map((key) => targets.current.get(key)?.() ?? null).filter((t): t is RevealTarget => t !== null),
    [changeKeys],
  );

  // After every move the student makes, bring what changed into view —
  // scrolling only the box it's in, only as far as needed, and never the
  // first time the walkthrough appears (the student is reading the verdict).
  // Painting runs in effects too, so this waits a frame for the marks.
  useEffect(() => {
    if (!active || moves === 0 || expanded || mode !== "walkthrough") return;
    const frame = requestAnimationFrame(() => revealTargets(resolveTargets()));
    return () => cancelAnimationFrame(frame);
  }, [active, moves, expanded, mode, resolveTargets]);

  // On arrival, say so if step 1's change is out of sight, rather than
  // scrolling the student away from their result.
  useEffect(() => {
    if (!active || moves !== 0 || mode !== "walkthrough") return;
    const frame = requestAnimationFrame(() => {
      setChangeOffscreen(resolveTargets().some((t) => !isVisible(t)));
    });
    return () => cancelAnimationFrame(frame);
  }, [active, moves, mode, resolveTargets]);

  const showChange = useCallback(() => {
    setChangeOffscreen(false);
    revealTargets(resolveTargets());
  }, [resolveTargets]);

  const value = useMemo<WalkthroughHost | null>(
    () =>
      active && {
      view: active,
      steps,
      mediaBasePath,
      onQuestion,
      studentChoiceIndex,
      choiceNotes,
      finish,
      collectFeedback,
      folded,
      setFolded,
      index,
      total,
      go,
      shownIndex,
      states,
      changed,
      choiceChanges,
      pendingPrompt,
      promptResult,
      wrongTries,
      answerPrompt,
      showPromptAnswer,
      mode,
      setMode: writeMode,
      finished,
      setFinished,
      expanded,
      setExpanded,
      changeOffscreen,
      showChange,
      registerTarget,
    },
    [
      active,
      steps,
      mediaBasePath,
      onQuestion,
      studentChoiceIndex,
      choiceNotes,
      finish,
      collectFeedback,
      folded,
      setFolded,
      index,
      total,
      go,
      shownIndex,
      states,
      changed,
      choiceChanges,
      pendingPrompt,
      promptResult,
      wrongTries,
      answerPrompt,
      showPromptAnswer,
      mode,
      finished,
      expanded,
      changeOffscreen,
      showChange,
      registerTarget,
    ],
  );

  return <WalkthroughContext.Provider value={value}>{children}</WalkthroughContext.Provider>;
}

/**
 * What a question page wraps around its question: the walkthrough running on
 * the question once there is one to show (answered, and matching the
 * explanation), and nothing until then, so a page needs no branch of its own.
 */
export function QuestionWalkthrough({
  walkthrough,
  steps,
  mediaBasePath,
  studentChoiceIndex = null,
  choiceNotes = [],
  finish = null,
  collectFeedback = false,
  resetKey,
  children,
}: {
  walkthrough: WalkthroughView | null | undefined;
  steps: StepText[];
  mediaBasePath: string;
  studentChoiceIndex?: number | null;
  choiceNotes?: (string | null)[];
  finish?: WalkthroughFinish | null;
  /** On where a student is answering (not a preview or an answer key): the last step asks "Did this make sense?". */
  collectFeedback?: boolean;
  resetKey?: string;
  children: ReactNode;
}) {
  return (
    <WalkthroughProvider
      view={walkthrough ?? null}
      steps={steps}
      mediaBasePath={mediaBasePath}
      onQuestion
      studentChoiceIndex={studentChoiceIndex}
      choiceNotes={choiceNotes}
      finish={finish}
      collectFeedback={collectFeedback}
      resetKey={resetKey}
    >
      {children}
    </WalkthroughProvider>
  );
}

/** The state of the walkthrough's choices panel at the shown step, if it has one. */
export function choicesState(wt: WalkthroughHost) {
  const panel = wt.view.spec.panels.find((p) => p.type === "choices");
  const state = panel ? wt.states.get(panelId(panel)) : undefined;
  return state?.type === "choices" ? state.state : null;
}

/** The state of the walkthrough's passage panel at the shown step, if it has one. */
export function passageState(wt: WalkthroughHost) {
  const panel = wt.view.spec.panels.find((p) => p.type === "passage");
  const state = panel ? wt.states.get(panelId(panel)) : undefined;
  return state?.type === "passage" ? state.state : null;
}
